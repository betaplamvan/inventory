import "server-only";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

export const TOKEN_PREFIX = "inv_";
export type TokenScope = "read" | "write";

/** Tạo token mới. Trả về token gốc — chỉ hiển thị 1 lần, DB chỉ giữ hash. */
export async function createApiToken(userId: string, name: string, scope: TokenScope, expiresInDays: number | null) {
  const token = TOKEN_PREFIX + randomToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: name.slice(0, 60),
      tokenHash: sha256(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      scope,
      expiresAt: expiresInDays ? sql`now() + ${`${expiresInDays} days`}::interval` : null,
    })
    .returning({ id: apiTokens.id });
  return { id: row.id, token };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scope: apiTokens.scope,
      lastUsedAt: apiTokens.lastUsedAt,
      // Kết nối OAuth: access token chỉ sống 1 giờ và tự gia hạn → hạn thật là hạn của refresh token
      expiresAt: sql<Date | null>`coalesce(${apiTokens.refreshExpiresAt}, ${apiTokens.expiresAt})`.mapWith(apiTokens.expiresAt),
      createdAt: apiTokens.createdAt,
      oauth: sql<boolean>`${apiTokens.oauthClientId} is not null`,
      expired: sql<boolean>`coalesce(${apiTokens.refreshExpiresAt}, ${apiTokens.expiresAt}) <= now()`,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(userId: string, id: string) {
  await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
}

/** Xác thực header "Authorization: Bearer inv_…". Trả về chủ token + quyền, hoặc null. */
export async function verifyBearer(authorization: string | null) {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i);
  const token = m?.[1];
  if (!token || !token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId, scope: apiTokens.scope, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, sha256(token)),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`)),
      ),
    );
  if (!row) return null;
  // Ghi lần dùng cuối tối đa 1 lần/phút để đỡ ghi DB mỗi request
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiTokens.id, row.id),
        or(isNull(apiTokens.lastUsedAt), sql`${apiTokens.lastUsedAt} < now() - interval '1 minute'`),
      ),
    );
  return { tokenId: row.id, userId: row.userId, scope: row.scope as TokenScope };
}
