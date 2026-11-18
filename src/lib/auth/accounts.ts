import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { authIdentities, categories, items, locations, users } from "@/db/schema";
import type { GoogleProfile } from "./google";

/**
 * Đăng nhập bằng hồ sơ OAuth (theo luồng link_or_login_google của okia):
 *  1. Đã có identity (provider, sub)  → đăng nhập user đó
 *  2. Có user cùng email (email Google đã xác minh) → liên kết identity vào user đó
 *  3. Chưa có → tạo user mới
 * Trả về userId.
 */
export async function loginWithProfile(provider: string, profile: GoogleProfile) {
  return db.transaction(async (tx) => {
    const [ident] = await tx
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(and(eq(authIdentities.provider, provider), eq(authIdentities.subject, profile.sub)));

    let userId = ident?.userId;
    let created = false;

    if (!userId) {
      const [byEmail] = await tx.select({ id: users.id }).from(users).where(eq(users.email, profile.email));
      if (byEmail) {
        userId = byEmail.id;
      } else {
        const [row] = await tx
          .insert(users)
          .values({ email: profile.email, name: profile.name, avatarUrl: profile.picture })
          .returning({ id: users.id });
        userId = row.id;
        created = true;
      }
      await tx.insert(authIdentities).values({ provider, subject: profile.sub, userId }).onConflictDoNothing();
    }

    // Đồng bộ thông tin từ Google mỗi lần đăng nhập
    await tx
      .update(users)
      .set({
        name: sql`coalesce(${profile.name}, ${users.name})`,
        avatarUrl: sql`coalesce(${profile.picture}, ${users.avatarUrl})`,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, userId));

    if (created) {
      // Dữ liệu tạo trước khi có tài khoản (user_id NULL) → gán cho tài khoản đầu tiên
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
      if (n === 1) {
        await tx.update(categories).set({ userId }).where(isNull(categories.userId));
        await tx.update(locations).set({ userId }).where(isNull(locations.userId));
        await tx.update(items).set({ userId }).where(isNull(items.userId));
      }
    }
    return userId;
  });
}
