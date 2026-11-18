"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { categories, items, locations, media, stockMovements, type MovementType } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { buildSearchText, fieldErrors, itemFromFormData, parseNum, type ItemInput } from "@/lib/item-input";
import { removeObjects } from "@/lib/storage";

export type ActionResult =
  | { ok: true; id?: number; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function revalidateAll() {
  revalidatePath("/", "layout");
}

function pgErrorMessage(err: unknown): string {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (code === "23505") return "Mã SKU đã tồn tại, vui lòng chọn mã khác";
  console.error(err);
  return "Có lỗi xảy ra, vui lòng thử lại";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Bỏ danh mục / vị trí không thuộc user (chống gửi id của người khác). */
async function ownedRefs(userId: string, data: Pick<ItemInput, "categoryId" | "locationId">) {
  const [cat] = data.categoryId
    ? await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, data.categoryId), eq(categories.userId, userId)))
    : [];
  const [loc] = data.locationId
    ? await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, data.locationId), eq(locations.userId, userId)))
    : [];
  return { categoryId: cat?.id ?? null, locationId: loc?.id ?? null };
}

/** id mặt hàng nếu thuộc user, ngược lại null */
async function ownedItemId(userId: string, itemId: number, tx: Tx | typeof db = db) {
  if (!Number.isInteger(itemId)) return null;
  const [row] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId)));
  return row?.id ?? null;
}

/* ---------------- Thêm / sửa / xoá mặt hàng ---------------- */

export async function createItem(formData: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const parsed = itemFromFormData(formData);
  if (!parsed.success) {
    return { ok: false, error: "Dữ liệu chưa hợp lệ", fieldErrors: fieldErrors(parsed.error) };
  }
  const data = { ...parsed.data, ...(await ownedRefs(me.id, parsed.data)) };
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({
          ...data,
          userId: me.id,
          kind: data.kind as never,
          searchText: buildSearchText(data),
        })
        .returning({ id: items.id });
      if (data.quantity > 0) {
        await tx.insert(stockMovements).values({
          itemId: row.id,
          type: "in",
          delta: data.quantity,
          balanceAfter: data.quantity,
          unitPrice: data.unitPrice,
          note: "Tồn kho ban đầu",
        });
      }
      return row.id;
    });
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
  const data = { ...parsed.data, ...(await ownedRefs(me.id, parsed.data)) };
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ quantity: items.quantity })
        .from(items)
        .where(and(eq(items.id, id), eq(items.userId, me.id)))
        .for("update");
      if (!current) throw new Error("NOT_FOUND");

      await tx
        .update(items)
        .set({
          ...data,
          kind: data.kind as never,
          searchText: buildSearchText(data),
          updatedAt: new Date(),
        })
        .where(and(eq(items.id, id), eq(items.userId, me.id)));

      const delta = round3(data.quantity - current.quantity);
      if (delta !== 0) {
        await tx.insert(stockMovements).values({
          itemId: id,
          type: "adjust",
          delta,
          balanceAfter: data.quantity,
          note: "Sửa trực tiếp trong form",
        });
      }
    });
    revalidateAll();
    return { ok: true, id };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return { ok: false, error: "Không tìm thấy mặt hàng" };
    }
    return { ok: false, error: pgErrorMessage(err) };
  }
}

export async function deleteItem(id: number) {
  const me = await requireUser();
  if (!(await ownedItemId(me.id, id))) redirect("/items");
  const files = await db
    .select({ key: media.objectKey, thumb: media.thumbKey })
    .from(media)
    .where(eq(media.itemId, id));
  await db.delete(items).where(and(eq(items.id, id), eq(items.userId, me.id)));
  await removeObjects(files.flatMap((f) => [f.key, f.thumb]));
  revalidateAll();
  redirect("/items");
}

export async function duplicateItem(id: number) {
  const me = await requireUser();
  const src = await db.query.items.findFirst({ where: and(eq(items.id, id), eq(items.userId, me.id)) });
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

async function applyMovement(
  tx: Tx,
  userId: string,
  itemId: number,
  type: MovementType,
  amount: number,
  extra: { note?: string | null; reference?: string | null; unitPrice?: number | null } = {},
) {
  const [current] = await tx
    .select({ quantity: items.quantity })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId)))
    .for("update");
  if (!current) throw new Error("Không tìm thấy mặt hàng");

  let delta: number;
  if (type === "in") delta = Math.abs(amount);
  else if (type === "out") delta = -Math.abs(amount);
  else delta = amount - current.quantity; // kiểm kê: đặt số lượng thực tế

  const balance = round3(current.quantity + delta);
  if (balance < 0) {
    throw new Error(`Không đủ số lượng (hiện còn ${current.quantity})`);
  }
  delta = round3(delta);
  if (delta === 0 && type !== "adjust") throw new Error("Số lượng phải khác 0");

  await tx
    .update(items)
    .set({
      quantity: balance,
      updatedAt: new Date(),
      ...(type === "in" && extra.unitPrice != null ? { unitPrice: extra.unitPrice } : {}),
    })
    .where(eq(items.id, itemId));

  await tx.insert(stockMovements).values({
    itemId,
    type,
    delta,
    balanceAfter: balance,
    unitPrice: extra.unitPrice ?? null,
    reference: extra.reference || null,
    note: extra.note || null,
  });
  return balance;
}

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
    const balance = await db.transaction((tx) =>
      applyMovement(tx, me.id, itemId, type, amount, {
        unitPrice,
        note: String(formData.get("note") ?? "").trim(),
        reference: String(formData.get("reference") ?? "").trim(),
      }),
    );
    revalidateAll();
    return { ok: true, message: `Đã cập nhật. Tồn kho: ${balance}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Có lỗi xảy ra" };
  }
}

/** Nút +/- nhanh trên danh sách */
export async function quickAdjust(itemId: number, delta: number): Promise<ActionResult> {
  const me = await requireUser();
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "Số lượng không hợp lệ" };
  try {
    await db.transaction((tx) =>
      applyMovement(tx, me.id, itemId, delta > 0 ? "in" : "out", Math.abs(delta), { note: "Điều chỉnh nhanh" }),
    );
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Có lỗi xảy ra" };
  }
}

export async function deleteMovement(movementId: number) {
  const me = await requireUser();
  const [m] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .where(and(eq(stockMovements.id, movementId), eq(items.userId, me.id)));
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
    .where(and(eq(media.id, mediaId), eq(items.userId, userId)));
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
