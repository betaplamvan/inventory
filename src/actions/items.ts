"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { items, media, stockMovements, type MovementType } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { buildSearchText, fieldErrors, itemFromFormData, parseNum } from "@/lib/item-input";
import { InventoryError, createItemFor, pgErrorMessage, recordMovementFor, updateItemFor } from "@/lib/inventory/mutations";
import { liveItemOf } from "@/lib/inventory/scope";
import { trashItemFor } from "@/lib/inventory/trash";
import { linkShoppingToItemFor } from "@/lib/inventory/shopping";
import { removeObjects } from "@/lib/storage";

export type ActionResult =
  | { ok: true; id?: number; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function revalidateAll() {
  revalidatePath("/", "layout");
}

/* ---------------- Thêm / sửa / xoá mặt hàng ---------------- */

export async function createItem(formData: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const parsed = itemFromFormData(formData);
  if (!parsed.success) {
    return { ok: false, error: "Dữ liệu chưa hợp lệ", fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const id = await createItemFor(me.id, parsed.data);
    // Thêm từ danh sách cần mua ("đã mua → thêm vào kho"): gắn món đó với mặt hàng mới và đánh dấu đã mua
    const shoppingId = Number(formData.get("shoppingId"));
    if (Number.isInteger(shoppingId) && shoppingId > 0) {
      await linkShoppingToItemFor(me.id, shoppingId, id).catch(() => {});
    }
    revalidateAll();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: pgErrorMessage(err) };
  }
}

export async function updateItem(id: number, formData: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const parsed = itemFromFormData(formData);
  if (!parsed.success) {
    return { ok: false, error: "Dữ liệu chưa hợp lệ", fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    await updateItemFor(me.id, id, parsed.data);
    revalidateAll();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: pgErrorMessage(err) };
  }
}

/** Chuyển vào thùng rác (khôi phục được ở trang Thùng rác; xoá hẳn sau TRASH_DAYS ngày). */
export async function deleteItem(id: number) {
  const me = await requireUser();
  try {
    await trashItemFor(me.id, id);
  } catch (err) {
    // Không có / đã xoá rồi thì coi như xong; lỗi khác (DB…) phải nổi lên chứ không báo thành công giả
    if (!(err instanceof InventoryError)) throw err;
  }
  revalidateAll();
  redirect("/items");
}

export async function duplicateItem(id: number) {
  const me = await requireUser();
  const src = await db.query.items.findFirst({ where: and(eq(items.id, id), liveItemOf(me.id)) });
  if (!src) return;
  const { id: _id, createdAt: _c, updatedAt: _u, coverMediaId: _cv, sku, ...rest } = src;
  const name = `${src.name} (bản sao)`;
  const [row] = await db
    .insert(items)
    .values({
      ...rest,
      userId: me.id,
      name,
      searchText: buildSearchText({ ...rest, name }),
      sku: sku ? `${sku}-copy-${Date.now().toString(36)}` : null,
      quantity: 0,
    })
    .returning({ id: items.id });
  revalidateAll();
  redirect(`/items/${row.id}/edit`);
}

/* ---------------- Nhập / xuất / kiểm kê ---------------- */

export async function recordMovement(
  itemId: number,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireUser();
  const type = String(formData.get("type")) as MovementType;
  if (!["in", "out", "adjust"].includes(type)) return { ok: false, error: "Loại giao dịch không hợp lệ" };

  const amount = parseNum(formData.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount < 0) {
    return { ok: false, error: "Số lượng không hợp lệ" };
  }
  const unitPrice = parseNum(formData.get("unitPrice"));
  if (unitPrice != null && (Number.isNaN(unitPrice) || unitPrice < 0)) {
    return { ok: false, error: "Đơn giá không hợp lệ" };
  }

  try {
    const { balance } = await recordMovementFor(me.id, itemId, type, amount, {
      unitPrice,
      note: String(formData.get("note") ?? "").trim(),
      reference: String(formData.get("reference") ?? "").trim(),
    });
    revalidateAll();
    return { ok: true, message: `Đã cập nhật. Tồn kho: ${balance}` };
  } catch (err) {
    return { ok: false, error: pgErrorMessage(err) };
  }
}

/** Nút +/- nhanh trên danh sách */
export async function quickAdjust(itemId: number, delta: number): Promise<ActionResult> {
  const me = await requireUser();
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "Số lượng không hợp lệ" };
  try {
    await recordMovementFor(me.id, itemId, delta > 0 ? "in" : "out", Math.abs(delta), { note: "Điều chỉnh nhanh" });
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: pgErrorMessage(err) };
  }
}

export async function deleteMovement(movementId: number) {
  const me = await requireUser();
  const [m] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .where(and(eq(stockMovements.id, movementId), liveItemOf(me.id)));
  if (!m) return;
  // Chỉ xoá bản ghi lịch sử, không thay đổi tồn kho hiện tại.
  await db.delete(stockMovements).where(eq(stockMovements.id, m.id));
  revalidateAll();
}

/* ---------------- Ảnh / video ---------------- */

/** Media thuộc user (qua mặt hàng), hoặc undefined */
async function ownedMedia(userId: string, mediaId: number) {
  const [row] = await db
    .select({ media })
    .from(media)
    .innerJoin(items, eq(items.id, media.itemId))
    .where(and(eq(media.id, mediaId), liveItemOf(userId)));
  return row?.media;
}

export async function setCover(itemId: number, mediaId: number) {
  const me = await requireUser();
  const m = await ownedMedia(me.id, mediaId);
  if (!m || m.itemId !== itemId) return;
  await db.update(items).set({ coverMediaId: mediaId }).where(eq(items.id, itemId));
  revalidateAll();
}

export async function deleteMedia(mediaId: number) {
  const me = await requireUser();
  const owned = await ownedMedia(me.id, mediaId);
  if (!owned) return;
  const [m] = await db.delete(media).where(eq(media.id, owned.id)).returning();
  if (!m) return;
  // Nếu vừa xoá ảnh đại diện thì chọn ảnh khác
  const [item] = await db.select({ cover: items.coverMediaId }).from(items).where(eq(items.id, m.itemId));
  if (item && item.cover == null) {
    const [next] = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.itemId, m.itemId), eq(media.kind, "image"), ne(media.id, m.id)))
      .orderBy(media.sortOrder, media.id)
      .limit(1);
    if (next) await db.update(items).set({ coverMediaId: next.id }).where(eq(items.id, m.itemId));
  }
  await removeObjects([m.objectKey, m.thumbKey]);
  revalidateAll();
}
