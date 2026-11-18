import "server-only";
import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, items, uploadLinks } from "@/db/schema";
import { appBaseUrl } from "@/lib/auth/constants";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { InventoryError } from "./mutations";

/**
 * Link upload ngắn hạn: agent xin link qua MCP (create_upload_url) rồi POST file thẳng lên bằng curl.
 * Nội dung file không đi qua model → không tốn token, và agent không cần giữ API token.
 */

export const UPLOAD_LINK_PREFIX = "up_";
export const UPLOAD_LINK_MAX_MINUTES = 60;
export const UPLOAD_LINK_MAX_FILES = 50;

export async function createUploadLink(opts: {
  userId: string;
  itemId: number;
  apiTokenId?: string;
  minutes: number;
  maxUploads: number;
}) {
  const [item] = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.id, opts.itemId), eq(items.userId, opts.userId)));
  if (!item) throw new InventoryError(`Không có mặt hàng id=${opts.itemId}`);

  // Dọn link đã hết hạn của user này
  await db.delete(uploadLinks).where(and(eq(uploadLinks.userId, opts.userId), lte(uploadLinks.expiresAt, sql`now()`)));

  const minutes = Math.min(Math.max(1, Math.round(opts.minutes)), UPLOAD_LINK_MAX_MINUTES);
  const token = UPLOAD_LINK_PREFIX + randomToken();
  // Không cho link sống lâu hơn API token đã tạo ra nó
  const tokenExpiry = opts.apiTokenId
    ? sql`(select ${apiTokens.expiresAt} from ${apiTokens} where ${apiTokens.id} = ${opts.apiTokenId})`
    : sql`null`;
  const [row] = await db
    .insert(uploadLinks)
    .values({
      tokenHash: sha256(token),
      userId: opts.userId,
      itemId: item.id,
      apiTokenId: opts.apiTokenId ?? null,
      maxUploads: Math.min(Math.max(1, Math.round(opts.maxUploads)), UPLOAD_LINK_MAX_FILES),
      expiresAt: sql`least(now() + ${`${minutes} minutes`}::interval, coalesce(${tokenExpiry}, 'infinity'::timestamptz))`,
    })
    .returning({ expiresAt: uploadLinks.expiresAt, maxUploads: uploadLinks.maxUploads });

  return {
    item,
    url: `${appBaseUrl()}/api/media/upload?t=${token}`,
    expiresAt: row.expiresAt,
    maxUploads: row.maxUploads,
  };
}

/**
 * Dùng 1 lượt của link upload (tăng bộ đếm nguyên tử). Trả về chủ link + mặt hàng,
 * hoặc null nếu link sai / hết hạn / hết lượt.
 */
export async function consumeUploadLink(token: string) {
  if (!token.startsWith(UPLOAD_LINK_PREFIX) || token.length > 100) return null;
  const [row] = await db
    .update(uploadLinks)
    .set({ uploads: sql`${uploadLinks.uploads} + 1` })
    .where(
      and(
        eq(uploadLinks.tokenHash, sha256(token)),
        gt(uploadLinks.expiresAt, sql`now()`),
        lt(uploadLinks.uploads, uploadLinks.maxUploads),
      ),
    )
    .returning({ userId: uploadLinks.userId, itemId: uploadLinks.itemId });
  return row ?? null;
}
