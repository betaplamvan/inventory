import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, shoppingItems, type Domain } from "@/db/schema";
import { viaLabel } from "@/lib/auth/actor";
import { normalizeText } from "@/lib/format";
import { InventoryError, recordMovementFor } from "./mutations";
import { liveItemOf } from "./scope";

/**
 * Danh sách cần mua của từng kho. Người dùng thêm trên web; trợ lý / agent thêm khi brainstorm
 * (linh kiện còn thiếu cho mạch, món đồ để hoàn thiện bộ phối, nguyên liệu cho món ăn).
 * Đánh dấu "đã mua": nếu gắn với mặt hàng có sẵn thì nhập kho luôn (ghi lịch sử).
 */

export const MAX_SHOPPING_BATCH = 50;

export type ShoppingInput = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  itemId?: number | null;
};

export async function listShoppingFor(userId: string, domain?: Domain, opts: { includeDone?: boolean } = {}) {
  return db.query.shoppingItems.findMany({
    where: and(
      eq(shoppingItems.userId, userId),
      domain ? eq(shoppingItems.domain, domain) : undefined,
      opts.includeDone ? undefined : eq(shoppingItems.done, false),
    ),
    orderBy: [asc(shoppingItems.done), desc(shoppingItems.createdAt)],
    limit: 300,
  });
}

/** Gắn mặt hàng sẵn có: kiểm tra thuộc user + cùng kho, không thì bỏ gắn */
async function ownedItemId(userId: string, domain: Domain, itemId: number | null | undefined) {
  if (!itemId) return null;
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), liveItemOf(userId), eq(items.domain, domain)));
  return row?.id ?? null;
}

/** Thêm nhiều món; món trùng tên với món đang chờ mua thì cộng dồn ghi chú thay vì thêm dòng mới */
export async function addShoppingFor(userId: string, domain: Domain, list: ShoppingInput[]) {
  if (!list.length) return { added: [], merged: [] };
  if (list.length > MAX_SHOPPING_BATCH) throw new InventoryError(`Tối đa ${MAX_SHOPPING_BATCH} món mỗi lần`);
  const pending = await listShoppingFor(userId, domain);
  const byName = new Map(pending.map((p) => [normalizeText(p.name), p]));
  const by = viaLabel();
  const added: number[] = [];
  const merged: number[] = [];

  for (const it of list) {
    const name = it.name.trim().slice(0, 200);
    if (!name) continue;
    const itemId = await ownedItemId(userId, domain, it.itemId);
    const dup = byName.get(normalizeText(name));
    if (dup) {
      const note = [dup.note, it.note?.trim()].filter(Boolean).join(" · ").slice(0, 500) || null;
      await db
        .update(shoppingItems)
        .set({
          note,
          quantity: it.quantity ?? dup.quantity,
          unit: it.unit ?? dup.unit,
          itemId: itemId ?? dup.itemId,
        })
        .where(eq(shoppingItems.id, dup.id));
      merged.push(dup.id);
      continue;
    }
    const [row] = await db
      .insert(shoppingItems)
      .values({
        userId,
        domain,
        name,
        quantity: it.quantity ?? null,
        unit: it.unit?.trim().slice(0, 30) || null,
        note: it.note?.trim().slice(0, 500) || null,
        itemId,
        addedBy: by,
      })
      .returning({ id: shoppingItems.id });
    byName.set(normalizeText(name), { ...row, name } as never);
    added.push(row.id);
  }
  return { added, merged };
}

async function ownedShopping(userId: string, id: number) {
  const [row] = await db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.id, id), eq(shoppingItems.userId, userId)));
  if (!row) throw new InventoryError(`Không có món id=${id} trong danh sách cần mua`);
  return row;
}

/**
 * Đánh dấu đã mua / chưa mua. Đã mua + gắn mặt hàng + có số lượng + stockIn → nhập kho luôn.
 * Trả về số lượng mới của mặt hàng nếu đã nhập kho.
 */
export async function setShoppingDoneFor(
  userId: string,
  id: number,
  done: boolean,
  opts: { stockIn?: boolean; quantity?: number | null; unitPrice?: number | null } = {},
) {
  const row = await ownedShopping(userId, id);
  let balance: number | undefined;
  const qty = opts.quantity ?? row.quantity;
  if (done && !row.done && opts.stockIn && row.itemId && qty && qty > 0) {
    ({ balance } = await recordMovementFor(userId, row.itemId, "in", qty, {
      note: "Mua theo danh sách cần mua",
      unitPrice: opts.unitPrice ?? null,
    }));
  }
  await db
    .update(shoppingItems)
    .set({ done, doneAt: done ? sql`now()` : null })
    .where(eq(shoppingItems.id, id));
  return { row, balance };
}

export async function updateShoppingFor(userId: string, id: number, patch: Partial<ShoppingInput>) {
  const row = await ownedShopping(userId, id);
  const itemId = patch.itemId !== undefined ? await ownedItemId(userId, row.domain, patch.itemId) : row.itemId;
  await db
    .update(shoppingItems)
    .set({
      name: patch.name?.trim().slice(0, 200) || row.name,
      quantity: patch.quantity !== undefined ? patch.quantity : row.quantity,
      unit: patch.unit !== undefined ? patch.unit?.trim().slice(0, 30) || null : row.unit,
      note: patch.note !== undefined ? patch.note?.trim().slice(0, 500) || null : row.note,
      itemId,
    })
    .where(eq(shoppingItems.id, id));
}

export async function removeShoppingFor(userId: string, ids: number[]) {
  if (!ids.length) return 0;
  const rows = await db
    .delete(shoppingItems)
    .where(and(eq(shoppingItems.userId, userId), inArray(shoppingItems.id, ids)))
    .returning({ id: shoppingItems.id });
  return rows.length;
}

/** Món cần mua vừa được thêm thành mặt hàng mới trong kho → gắn và đánh dấu đã mua (không nhập kho thêm) */
export async function linkShoppingToItemFor(userId: string, id: number, itemId: number) {
  await ownedShopping(userId, id);
  await db
    .update(shoppingItems)
    .set({ itemId, done: true, doneAt: sql`now()` })
    .where(and(eq(shoppingItems.id, id), eq(shoppingItems.userId, userId)));
}

/** Xoá các món đã mua của một kho */
export async function clearDoneShoppingFor(userId: string, domain: Domain) {
  const rows = await db
    .delete(shoppingItems)
    .where(and(eq(shoppingItems.userId, userId), eq(shoppingItems.domain, domain), eq(shoppingItems.done, true)))
    .returning({ id: shoppingItems.id });
  return rows.length;
}
