import "server-only";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, items, mediaLinks } from "@/db/schema";
import { appBaseUrl } from "@/lib/auth/constants";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { InventoryError } from "./mutations";
import { liveItemOf } from "./scope";

/**
 * Link xem ảnh có thời hạn: tool MCP get_item_images trả URL có kèm token để client chat
 * (Claude web / điện thoại) tải ảnh và hiển thị ngay trong câu trả lời — trình duyệt ở đó
 * không có cookie đăng nhập của app (cookie SameSite=Lax không được gửi kèm ảnh nhúng từ site khác).
 *
 * Bảo vệ: token ngẫu nhiên 256-bit trong URL (DB chỉ lưu SHA-256), chỉ ĐỌC, chỉ ẢNH của đúng
 * 1 mặt hàng (không mở được video / PDF / file khác), có hạn, mất hiệu lực khi thu hồi
 * API token đã tạo ra nó. Ai giữ URL thì xem được trong thời hạn đó.
 *
 * Hạn dài hay ngắn là đánh đổi: hết hạn thì ảnh trong đoạn chat cũ không hiện lại được nữa.
 * 30 ngày để xem lại được lịch sử chat; URL chỉ nằm trong chính đoạn chat của chủ kho.
 */

export const MEDIA_LINK_PREFIX = "ml_";
export const MEDIA_LINK_DAYS = 30;

export async function createMediaLink(opts: { userId: string; itemId: number; apiTokenId?: string }) {
  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, opts.itemId), liveItemOf(opts.userId)));
  if (!item) throw new InventoryError(`Không có mặt hàng id=${opts.itemId}`);

  // Dọn link đã hết hạn của user này
  await db.delete(mediaLinks).where(and(eq(mediaLinks.userId, opts.userId), lte(mediaLinks.expiresAt, sql`now()`)));

  const token = MEDIA_LINK_PREFIX + randomToken();
  // Không cho link sống lâu hơn kết nối đã tạo ra nó. Kết nối OAuth: expires_at chỉ là hạn của
  // access token (1 giờ, tự xoay vòng) nên lấy hạn của refresh token.
  const tokenExpiry = opts.apiTokenId
    ? sql`(select coalesce(${apiTokens.refreshExpiresAt}, ${apiTokens.expiresAt}) from ${apiTokens} where ${apiTokens.id} = ${opts.apiTokenId})`
    : sql`null`;
  const [row] = await db
    .insert(mediaLinks)
    .values({
      tokenHash: sha256(token),
      userId: opts.userId,
      itemId: item.id,
      apiTokenId: opts.apiTokenId ?? null,
      expiresAt: sql`least(now() + ${`${MEDIA_LINK_DAYS} days`}::interval, coalesce(${tokenExpiry}, 'infinity'::timestamptz))`,
    })
    .returning({ expiresAt: mediaLinks.expiresAt });

  return {
    expiresAt: row.expiresAt,
    /** URL xem 1 ảnh của mặt hàng này (thumb = bản thu nhỏ webp nếu có) */
    urlFor: (mediaId: number, opts: { thumb?: boolean } = {}) =>
      `${appBaseUrl()}/api/media/${mediaId}?${opts.thumb ? "thumb=1&" : ""}t=${token}`,
  };
}

/** Chủ link + mặt hàng được phép xem, hoặc null nếu link sai / hết hạn. */
export async function resolveMediaLink(token: string) {
  if (!token.startsWith(MEDIA_LINK_PREFIX) || token.length > 100) return null;
  const [row] = await db
    .select({ userId: mediaLinks.userId, itemId: mediaLinks.itemId })
    .from(mediaLinks)
    .where(and(eq(mediaLinks.tokenHash, sha256(token)), gt(mediaLinks.expiresAt, sql`now()`)));
  return row ?? null;
}
