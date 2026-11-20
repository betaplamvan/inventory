import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { categories, items, locations, stockMovements, type MovementType } from "@/db/schema";
import { currentVia } from "@/lib/auth/actor";
import { buildSearchText, type ItemInput } from "@/lib/item-input";
import { alertOnStockChange } from "@/lib/notify";
import { liveItemOf } from "./scope";

/**
 * Nghiệp vụ ghi dữ liệu kho, dùng chung cho Server Actions (web) và MCP (agent).
 * Mọi hàm nhận userId và chỉ đụng tới dữ liệu của user đó (bỏ qua mặt hàng trong thùng rác).
 * Mỗi dòng lịch sử ghi kèm nguồn thao tác (web / agent + tên token / import) lấy từ currentVia().
 */

export class InventoryError extends Error {}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Cột nguồn thao tác cho 1 dòng lịch sử */
const sourceCols = () => {
  const via = currentVia();
  return { source: via.source, sourceName: via.name ?? null };
};

export function pgErrorMessage(err: unknown): string {
  if (err instanceof InventoryError) return err.message;
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (code === "23505") return "Mã SKU đã tồn tại, vui lòng chọn mã khác";
  console.error(err);
  return "Có lỗi xảy ra, vui lòng thử lại";
}

/** Bỏ danh mục / vị trí không thuộc user (chống dùng id của người khác). */
export async function ownedRefs(userId: string, data: Pick<ItemInput, "categoryId" | "locationId">) {
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

export async function createItemFor(userId: string, input: ItemInput) {
  const data = { ...input, ...(await ownedRefs(userId, input)) };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(items)
      .values({ ...data, userId, kind: data.kind as never, searchText: buildSearchText(data) })
      .returning({ id: items.id });
    if (data.quantity > 0) {
      await tx.insert(stockMovements).values({
        itemId: row.id,
        type: "in",
        delta: data.quantity,
        balanceAfter: data.quantity,
        unitPrice: data.unitPrice,
        note: "Tồn kho ban đầu",
        ...sourceCols(),
      });
    }
    return row.id;
  });
}

/** Cập nhật toàn bộ thông tin; nếu số lượng đổi thì ghi một lần kiểm kê. */
export async function updateItemFor(userId: string, id: number, input: ItemInput, adjustNote = "Sửa trực tiếp trong form") {
  const data = { ...input, ...(await ownedRefs(userId, input)) };
  const before = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ quantity: items.quantity, minQuantity: items.minQuantity })
      .from(items)
      .where(and(eq(items.id, id), liveItemOf(userId)))
      .for("update");
    if (!current) throw new InventoryError("Không tìm thấy mặt hàng");

    await tx
      .update(items)
      .set({ ...data, kind: data.kind as never, searchText: buildSearchText(data), updatedAt: new Date() })
      .where(and(eq(items.id, id), eq(items.userId, userId)));

    const delta = round3(data.quantity - current.quantity);
    if (delta !== 0) {
      await tx.insert(stockMovements).values({
        itemId: id,
        type: "adjust",
        delta,
        balanceAfter: data.quantity,
        note: adjustNote,
        ...sourceCols(),
      });
    }
    return current;
  });
  alertOnStockChange(userId, id, before, data);
}

export type MovementExtra = { note?: string | null; reference?: string | null; unitPrice?: number | null };

async function applyMovement(tx: Tx, userId: string, itemId: number, type: MovementType, amount: number, extra: MovementExtra) {
  const [current] = await tx
    .select({ quantity: items.quantity, minQuantity: items.minQuantity })
    .from(items)
    .where(and(eq(items.id, itemId), liveItemOf(userId)))
    .for("update");
  if (!current) throw new InventoryError("Không tìm thấy mặt hàng");

  let delta: number;
  if (type === "in") delta = Math.abs(amount);
  else if (type === "out") delta = -Math.abs(amount);
  else delta = amount - current.quantity; // kiểm kê: đặt số lượng thực tế

  const balance = round3(current.quantity + delta);
  if (balance < 0) throw new InventoryError(`Không đủ số lượng (hiện còn ${current.quantity})`);
  delta = round3(delta);
  if (delta === 0 && type !== "adjust") throw new InventoryError("Số lượng phải khác 0");

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
    ...sourceCols(),
  });
  return { delta, balance, before: current };
}

/** Nhập / xuất / kiểm kê. Trả về thay đổi và tồn kho mới. */
export async function recordMovementFor(
  userId: string,
  itemId: number,
  type: MovementType,
  amount: number,
  extra: MovementExtra = {},
) {
  if (!Number.isFinite(amount) || amount < 0) throw new InventoryError("Số lượng không hợp lệ");
  const { delta, balance, before } = await db.transaction((tx) => applyMovement(tx, userId, itemId, type, amount, extra));
  alertOnStockChange(userId, itemId, before, { quantity: balance, minQuantity: before.minQuantity });
  return { delta, balance };
}

/* ---------------- Danh mục / vị trí ---------------- */

type TaxTable = typeof categories | typeof locations;

/** Kiểm tra mục cha thuộc user và không tạo vòng lặp cha-con. Trả về thông báo lỗi hoặc null. */
export async function parentProblem(table: TaxTable, userId: string, id: number | null, parentId: number | null) {
  if (parentId == null) return null;
  const rows = await db.select({ id: table.id, parentId: table.parentId }).from(table).where(eq(table.userId, userId));
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  if (!parentOf.has(parentId)) return "Mục cha không hợp lệ";
  if (id == null) return null;
  let cur: number | null | undefined = parentId;
  let guard = 0;
  while (cur != null && guard++ < 100) {
    if (cur === id) return "Không thể chọn chính nó hoặc mục con làm mục cha";
    cur = parentOf.get(cur);
  }
  return null;
}

export async function createCategoryFor(
  userId: string,
  data: { name: string; parentId?: number | null; description?: string | null; sortOrder?: number },
) {
  const problem = await parentProblem(categories, userId, null, data.parentId ?? null);
  if (problem) throw new InventoryError(problem);
  const [row] = await db
    .insert(categories)
    .values({ userId, name: data.name, parentId: data.parentId ?? null, description: data.description ?? null, sortOrder: data.sortOrder ?? 0 })
    .returning({ id: categories.id });
  return row.id;
}

export async function createLocationFor(
  userId: string,
  data: { name: string; parentId?: number | null; description?: string | null; code?: string | null },
) {
  const problem = await parentProblem(locations, userId, null, data.parentId ?? null);
  if (problem) throw new InventoryError(problem);
  const [row] = await db
    .insert(locations)
    .values({ userId, name: data.name, parentId: data.parentId ?? null, description: data.description ?? null, code: data.code ?? null })
    .returning({ id: locations.id });
  return row.id;
}
