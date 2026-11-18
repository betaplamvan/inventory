import "server-only";
import { and, asc, count, desc, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  items,
  locations,
  media,
  stockMovements,
  type Category,
  type ItemKind,
  type Location,
  type MovementType,
} from "@/db/schema";
import { normalizeText } from "./format";
import { currentUserId } from "./auth/actor";

/** id người dùng hiện tại (web: cookie phiên; MCP: chủ API token) — mọi truy vấn đều lọc theo đây */
const uid = currentUserId;
import { PAGE_SIZE } from "./constants";

/* ------------------------------------------------------------------ */
/* Cây danh mục / vị trí                                               */
/* ------------------------------------------------------------------ */

export type TreeNode<T> = T & { depth: number; path: string; itemCount: number };

/** Sắp xếp danh sách phẳng thành cây (theo thứ tự duyệt), kèm đường dẫn "Cha › Con". */
function flattenTree<T extends { id: number; parentId: number | null; name: string }>(
  rows: T[],
  counts: Map<number, number>,
): TreeNode<T>[] {
  const byParent = new Map<number | null, T[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const p = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(r);
  }
  const out: TreeNode<T>[] = [];
  const visit = (parent: number | null, depth: number, prefix: string) => {
    for (const r of byParent.get(parent) ?? []) {
      const path = prefix ? `${prefix} › ${r.name}` : r.name;
      out.push({ ...r, depth, path, itemCount: counts.get(r.id) ?? 0 });
      if (depth < 10) visit(r.id, depth + 1, path);
    }
  };
  visit(null, 0, "");
  // Cộng dồn số mặt hàng của mục con lên mục cha (khớp với bộ lọc, vốn gồm cả mục con)
  const byId = new Map(out.map((n) => [n.id, n]));
  for (const n of out) {
    const own = counts.get(n.id) ?? 0;
    let p = n.parentId != null ? byId.get(n.parentId) : undefined;
    let guard = 0;
    while (p && guard++ < 20) {
      p.itemCount += own;
      p = p.parentId != null ? byId.get(p.parentId) : undefined;
    }
  }
  return out;
}

export async function getCategoryTree() {
  const userId = await uid();
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ id: items.categoryId, n: count() })
      .from(items)
      .where(eq(items.userId, userId))
      .groupBy(items.categoryId),
  ]);
  return flattenTree<Category>(rows, new Map(counts.map((c) => [c.id ?? -1, c.n])));
}

export async function getLocationTree() {
  const userId = await uid();
  const [rows, counts] = await Promise.all([
    db.select().from(locations).where(eq(locations.userId, userId)).orderBy(asc(locations.name)),
    db
      .select({ id: items.locationId, n: count() })
      .from(items)
      .where(eq(items.userId, userId))
      .groupBy(items.locationId),
  ]);
  return flattenTree<Location>(rows, new Map(counts.map((c) => [c.id ?? -1, c.n])));
}

/** id + toàn bộ id con cháu */
function descendantIds<T extends { id: number; parentId: number | null }>(rows: T[], rootId: number) {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (r.parentId != null && result.has(r.parentId) && !result.has(r.id)) {
        result.add(r.id);
        changed = true;
      }
    }
  }
  return [...result];
}

/* ------------------------------------------------------------------ */
/* Danh sách mặt hàng                                                  */
/* ------------------------------------------------------------------ */

export type StockFilter = "all" | "low" | "out" | "in";
export type SortKey = "updated" | "name" | "qty" | "value" | "created";

export type ItemFilters = {
  q?: string;
  categoryId?: number;
  locationId?: number;
  kind?: ItemKind;
  stock?: StockFilter;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

/** "Sắp hết / cần mua": có đặt mức tối thiểu và số lượng <= mức đó (gồm cả đã hết) */
export const lowStockCond = and(gt(items.minQuantity, 0), lte(items.quantity, items.minQuantity))!;
export const outOfStockCond = lte(items.quantity, 0);

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function buildItemWhere(f: ItemFilters) {
  const userId = await uid();
  const conds: SQL[] = [eq(items.userId, userId)];
  if (f.q) {
    for (const word of normalizeText(f.q).split(" ").filter(Boolean)) {
      conds.push(sql`${items.searchText} like ${`%${escapeLike(word)}%`}`);
    }
  }
  if (f.categoryId) {
    const rows = await db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.userId, userId));
    conds.push(inArray(items.categoryId, descendantIds(rows, f.categoryId)));
  }
  if (f.locationId) {
    const rows = await db
      .select({ id: locations.id, parentId: locations.parentId })
      .from(locations)
      .where(eq(locations.userId, userId));
    conds.push(inArray(items.locationId, descendantIds(rows, f.locationId)));
  }
  if (f.kind) conds.push(eq(items.kind, f.kind));
  if (f.stock === "low") conds.push(lowStockCond);
  if (f.stock === "out") conds.push(outOfStockCond);
  if (f.stock === "in") conds.push(gt(items.quantity, 0));
  return and(...conds);
}

function orderFor(sort: SortKey | undefined) {
  switch (sort) {
    case "name":
      return [asc(items.name)];
    case "qty":
      return [asc(items.quantity), asc(items.name)];
    case "value":
      return [desc(sql`${items.quantity} * coalesce(${items.unitPrice}, 0)`), asc(items.name)];
    case "created":
      return [desc(items.createdAt)];
    default:
      return [desc(items.updatedAt)];
  }
}

export async function listItems(f: ItemFilters) {
  const pageSize = f.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, f.page ?? 1);
  const where = await buildItemWhere(f);

  const [rows, [{ total }]] = await Promise.all([
    db.query.items.findMany({
      where,
      orderBy: orderFor(f.sort),
      limit: pageSize,
      offset: (page - 1) * pageSize,
      with: { category: true, location: true, cover: true },
    }),
    db.select({ total: count() }).from(items).where(where),
  ]);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type ItemListRow = Awaited<ReturnType<typeof listItems>>["rows"][number];

/** Dùng cho export CSV: không phân trang */
export async function listAllItems(f: ItemFilters) {
  const where = await buildItemWhere(f);
  return db.query.items.findMany({
    where,
    orderBy: orderFor(f.sort ?? "name"),
    with: { category: true, location: true },
  });
}

/* ------------------------------------------------------------------ */
/* Chi tiết mặt hàng                                                   */
/* ------------------------------------------------------------------ */

export async function getItem(id: number) {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const userId = await uid();
  return db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: {
      category: true,
      location: true,
      media: { orderBy: [asc(media.sortOrder), asc(media.id)] },
    },
  });
}

export type ItemDetail = NonNullable<Awaited<ReturnType<typeof getItem>>>;

export async function getItemMovements(itemId: number, limit = 50) {
  const userId = await uid();
  const rows = await db
    .select({ m: stockMovements })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .where(and(eq(stockMovements.itemId, itemId), eq(items.userId, userId)))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(limit);
  return rows.map((r) => r.m);
}

/* ------------------------------------------------------------------ */
/* Lịch sử nhập / xuất                                                 */
/* ------------------------------------------------------------------ */

export async function listMovements(opts: { type?: MovementType; q?: string; page?: number }) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const conds: SQL[] = [eq(items.userId, await uid())];
  if (opts.type) conds.push(eq(stockMovements.type, opts.type));
  if (opts.q) {
    for (const word of normalizeText(opts.q).split(" ").filter(Boolean)) {
      const like = `%${escapeLike(word)}%`;
      conds.push(
        sql`(${items.searchText} like ${like} or lower(coalesce(${stockMovements.reference}, '')) like ${like} or lower(coalesce(${stockMovements.note}, '')) like ${like})`,
      );
    }
  }
  const where = and(...conds);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        movement: stockMovements,
        item: { id: items.id, name: items.name, unit: items.unit, sku: items.sku },
      })
      .from(stockMovements)
      .innerJoin(items, eq(items.id, stockMovements.itemId))
      .where(where)
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(stockMovements)
      .innerJoin(items, eq(items.id, stockMovements.itemId))
      .where(where),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export async function getDashboard() {
  const userId = await uid();
  const mine = eq(items.userId, userId);
  const [[totals], byKind, byCategory, lowStock, recent] = await Promise.all([
    db
      .select({
        items: count(),
        value: sql<number>`coalesce(sum(${items.quantity} * coalesce(${items.unitPrice}, 0)), 0)::float8`,
        low: sql<number>`count(*) filter (where ${lowStockCond})::int`,
        out: sql<number>`count(*) filter (where ${outOfStockCond})::int`,
      })
      .from(items)
      .where(mine),
    db
      .select({ kind: items.kind, n: count() })
      .from(items)
      .where(mine)
      .groupBy(items.kind)
      .orderBy(desc(count())),
    db
      .select({
        id: categories.id,
        name: categories.name,
        n: count(items.id),
        value: sql<number>`coalesce(sum(${items.quantity} * coalesce(${items.unitPrice}, 0)), 0)::float8`,
      })
      .from(categories)
      .leftJoin(items, eq(items.categoryId, categories.id))
      .where(eq(categories.userId, userId))
      .groupBy(categories.id, categories.name)
      .orderBy(desc(count(items.id)))
      .limit(8),
    db.query.items.findMany({
      where: and(mine, lowStockCond),
      orderBy: [asc(sql`${items.quantity} / nullif(${items.minQuantity}, 0)`), asc(items.name)],
      limit: 10,
      with: { cover: true, location: true },
    }),
    db
      .select({
        movement: stockMovements,
        item: { id: items.id, name: items.name, unit: items.unit },
      })
      .from(stockMovements)
      .innerJoin(items, eq(items.id, stockMovements.itemId))
      .where(mine)
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(10),
  ]);

  return { totals, byKind, byCategory, lowStock, recent };
}

export async function countLowStock() {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(and(eq(items.userId, await uid()), lowStockCond));
  return row?.n ?? 0;
}

/** Gợi ý cho ô nhập (nhà sản xuất, package, nhà cung cấp, tag) */
export async function getSuggestions() {
  const userId = await uid();
  const distinct = (col: typeof items.manufacturer | typeof items.package | typeof items.supplier) =>
    db
      .selectDistinct({ v: sql<string>`${col}` })
      .from(items)
      .where(and(eq(items.userId, userId), sql`${col} is not null and ${col} <> ''`))
      .orderBy(sql`1`)
      .limit(200);
  const [manufacturers, packages, suppliers, tags] = await Promise.all([
    distinct(items.manufacturer),
    distinct(items.package),
    distinct(items.supplier),
    db.execute<{ tag: string }>(sql`select distinct unnest(${items.tags}) as tag from ${items} where ${items.userId} = ${userId} order by 1 limit 300`),
  ]);
  return {
    manufacturers: manufacturers.map((r) => r.v!),
    packages: packages.map((r) => r.v!),
    suppliers: suppliers.map((r) => r.v!),
    tags: [...tags].map((r) => r.tag),
  };
}
