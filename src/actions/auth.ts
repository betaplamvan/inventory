"use server";

import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { items, media, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth/crypto";
import { destroyAllSessions, destroyCurrentSession, requireUser } from "@/lib/auth/session";
import { removeObjects } from "@/lib/storage";

export type FormState = { ok?: boolean; error?: string; message?: string } | null;

export async function logout() {
  await destroyCurrentSession();
  redirect("/login");
}

export async function logoutOtherDevices(): Promise<FormState> {
  const me = await requireUser();
  await destroyAllSessions(me.id, me.sessionId);
  return { ok: true, message: "Đã đăng xuất khỏi tất cả thiết bị khác." };
}

/** Xoá tài khoản + toàn bộ kho (cần gõ lại email để xác nhận). */
export async function deleteAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  if (normalizeEmail(String(fd.get("confirmEmail") ?? "")) !== me.email) {
    return { error: "Email xác nhận không khớp" };
  }
  // Thu thập file trên MinIO trước khi xoá (DB tự xoá dây chuyền theo user)
  const files = await db
    .select({ key: media.objectKey, thumb: media.thumbKey })
    .from(media)
    .where(inArray(media.itemId, db.select({ id: items.id }).from(items).where(eq(items.userId, me.id))));
  await db.delete(users).where(eq(users.id, me.id));
  await removeObjects(files.flatMap((f) => [f.key, f.thumb]));
  await destroyCurrentSession();
  redirect("/login");
}
