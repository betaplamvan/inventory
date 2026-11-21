import "server-only";
import { and, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, media, type Domain } from "@/db/schema";
import { viaLabel } from "@/lib/auth/actor";
import { removeObjects } from "@/lib/storage";
import { InventoryError } from "./mutations";
import { liveItem, liveItemOf } from "./scope";

/**
 * Thùng rác: "xoá" mặt hàng chỉ đánh dấu deleted_at (ảnh, lịch sử giữ nguyên) nên khôi phục được.
 * Sau TRASH_DAYS ngày thì xoá hẳn — dọn mỗi khi user đó chuyển thêm món vào thùng rác hoặc mở trang Thùng rác.
 */
export const TRASH_DAYS = 30;

const trashedOf = (userId: string) => and(eq(items.userId, userId), isNotNull(items.deletedAt))!;

/** Chuyển vào thùng rác. Trả về tên mặt hàng. */
export async function trashItemFor(userId: string, id: number) {
  const [row] = await db
    .update(items)
    .set({ deletedAt: sql`now()`, deletedBy: viaLabel() })
    .where(and(eq(items.id, id), liveItemOf(userId)))
    .returning({ id: items.id, name: items.name });
  if (!row) throw new InventoryError(`Không có mặt hàng id=${id}`);
  await purgeTrashFor(userId, "expired").catch((err) => console.error("[trash] lỗi dọn thùng rác:", err));
  return row;
}

/**
 * Khôi phục từ thùng rác. Nếu trong lúc đó SKU đã được mặt hàng khác dùng thì bỏ trống SKU
 * (skuCleared = SKU cũ) thay vì từ chối khôi phục.
 */
export async function restoreItemFor(userId: string, id: number) {
  return db.transaction(async (tx) => {
    const [it] = await tx
      .select({ id: items.id, name: items.name, sku: items.sku })
      .from(items)
      .where(and(eq(items.id, id), trashedOf(userId)))
      .for("update");
    if (!it) throw new InventoryError(`Thùng rác không có mặt hàng id=${id}`);

    const [clash] = it.sku
      ? await tx
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.userId, userId), eq(items.sku, it.sku), liveItem, ne(items.id, id)))
      : [];
    await tx
      .update(items)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date(), ...(clash ? { sku: null } : {}) })
      .where(eq(items.id, id));
    return { id: it.id, name: it.name, skuCleared: clash ? it.sku : null };
  });
}

/** Món trong thùng rác; domain bỏ trống = mọi kho */
export async function listTrashFor(userId: string, domain?: Domain) {
  return db.query.items.findMany({
    where: domain ? and(trashedOf(userId), eq(items.domain, domain)) : trashedOf(userId),
    orderBy: [desc(items.deletedAt)],
    columns: {
      id: true,
      domain: true,
      name: true,
      sku: true,
      quantity: true,
      unit: true,
      deletedAt: true,
      deletedBy: true,
    },
    with: { cover: true },
  });
}

/**
 * Xoá hẳn (cả ảnh/video trên MinIO và lịch sử): một danh sách id, tất cả, hoặc những món đã quá hạn.
 * Chỉ đụng tới món đang nằm trong thùng rác. Trả về số mặt hàng đã xoá.
 */
export async function purgeTrashFor(userId: string, which: number[] | "all" | "expired", domain?: Domain) {
  const cond =
    which === "all"
      ? domain
        ? and(trashedOf(userId), eq(items.domain, domain))
        : trashedOf(userId)
      : which === "expired"
        ? and(trashedOf(userId), lt(items.deletedAt, sql`now() - ${`${TRASH_DAYS} days`}::interval`))
        : which.length
          ? and(trashedOf(userId), inArray(items.id, which))
          : null;
  if (!cond) return 0;

  const targets = await db.select({ id: items.id }).from(items).where(cond);
  if (!targets.length) return 0;
  const ids = targets.map((t) => t.id);
  const files = await db
    .select({ key: media.objectKey, thumb: media.thumbKey })
    .from(media)
    .where(inArray(media.itemId, ids));
  const deleted = await db.delete(items).where(and(trashedOf(userId), inArray(items.id, ids))).returning({ id: items.id });
  await removeObjects(files.flatMap((f) => [f.key, f.thumb]));
  return deleted.length;
}
