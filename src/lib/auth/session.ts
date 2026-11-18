import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { SESSION_COOKIE, SESSION_DAYS, sessionCookieOptions } from "./constants";
import { randomToken, sha256 } from "./crypto";

export type CurrentUser = Pick<User, "id" | "email" | "name" | "avatarUrl"> & { sessionId: string };

const DAY = 24 * 60 * 60 * 1000;

/** Tạo phiên mới và đặt cookie (chỉ gọi trong Server Action / Route Handler). */
export async function createSession(userId: string) {
  const token = randomToken();
  const ua = (await headers()).get("user-agent")?.slice(0, 256) ?? null;
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    userAgent: ua,
    expiresAt: new Date(Date.now() + SESSION_DAYS * DAY),
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  // dọn phiên hết hạn của user này
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
}

/**
 * Người dùng hiện tại (hoặc null). Được cache trong 1 lần render.
 * Gia hạn phiên (sliding) tối đa 1 lần/ngày.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // So thời gian bằng now() của Postgres: không đọc giờ hiện tại trong JS lúc render
  // (Cache Components coi new Date()/Date.now() khi prerender là giá trị không ổn định).
  const [row] = await db
    .select({
      sessionId: sessions.id,
      stale: sql<boolean>`${sessions.lastSeenAt} < now() - interval '1 day'`,
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, sql`now()`)));

  if (!row) return null;

  if (row.stale) {
    await db
      .update(sessions)
      .set({
        lastSeenAt: sql`now()`,
        expiresAt: sql`now() + ${`${SESSION_DAYS} days`}::interval`,
      })
      .where(eq(sessions.id, row.sessionId));
  }
  const { stale: _s, ...user } = row;
  return user;
});

/** Bắt buộc đăng nhập: chuyển về /login nếu chưa có phiên hợp lệ. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Đăng xuất phiên hiện tại. */
export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  store.delete(SESSION_COOKIE);
}

/** Đăng xuất mọi thiết bị (tuỳ chọn giữ lại phiên hiện tại). */
export async function destroyAllSessions(userId: string, keepSessionId?: string) {
  await db
    .delete(sessions)
    .where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId));
}

export async function countSessions(userId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)));
  return r?.n ?? 0;
}
