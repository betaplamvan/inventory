import "server-only";
import { and, asc, count, desc, eq, gt, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  items,
  locations,
  media,
  stockMovements,
  type Category,
  type Domain,
  type ItemKind,
  type Location,
  type MovementType,
} from "@/db/schema";
import { normalizeText } from "./format";
import { currentUserId } from "./auth/actor";
import { PAGE_SIZE } from "./constants";
import { EXPIRING_DAYS } from "./domains";
import { liveItem, liveItemOf } from "./inventory/scope";

/** id người dùng hiện tại (web: cookie phiên; MCP: chủ API token) — mọi truy vấn đều lọc theo đây */
const uid = currentUserId;
// Mọi truy vấn mặt hàng dùng liveItemOf(userId): của user đó và không nằm trong thùng rác.
// domain: kho cần xem (web luôn truyền kho đang chọn); bỏ trống = mọi kho (agent / MCP tìm chung).
const inDomain = (col: typeof items.domain | typeof categories.domain | typeof locations.domain, d?: Domain) =>
  d ? [eq(col, d)] : [];

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

export async function getCategoryTree(domain?: Domain) {
  const userId = await uid();
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), ...inDomain(categories.domain, domain)))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ id: items.categoryId, n: count() })
      .from(items)
      .where(liveItemOf(userId))
      .groupBy(items.categoryId),
  ]);
  return flattenTree<Category>(rows, new Map(counts.map((c) => [c.id ?? -1, c.n])));
}

export async function getLocationTree(domain?: Domain) {
  const userId = await uid();
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(locations)
      .where(and(eq(locations.userId, userId), ...inDomain(locations.domain, domain)))
      .orderBy(asc(locations.name)),
    db
      .select({ id: items.locationId, n: count() })
      .from(items)
      .where(liveItemOf(userId))
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

export type StockFilter = "all" | "low" | "out" | "in" | "expiring" | "expired";
export type SortKey = "updated" | "name" | "qty" | "value" | "created" | "expiry";

export type ItemFilters = {
  /** Bỏ trống = mọi kho */
  domain?: Domain;
  q?: string;
  categoryId?: number;
  locationId?: number;
  kind?: ItemKind;
  stock?: StockFilter;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
  /** Chỉ các id này (in nhãn cho những mặt hàng đã chọn) */
  ids?: number[];
};

/** "Sắp hết / cần mua": có đặt mức tối thiểu và số lượng <= mức đó (gồm cả đã hết) */
export const lowStockCond = and(gt(items.minQuantity, 0), lte(items.quantity, items.minQuantity))!;
export const outOfStockCond = lte(items.quantity, 0);
/** Hôm nay theo giờ Việt Nam (hạn sử dụng là ngày, không giờ) */
const todayVN = sql`(now() at time zone 'Asia/Ho_Chi_Minh')::date`;
/** Số ngày còn tới hạn sử dụng (âm = đã quá hạn, null = không có hạn) — tính theo giờ VN trong SQL */
export const expiryDays = sql<number | null>`(${items.expiresAt} - (now() at time zone 'Asia/Ho_Chi_Minh')::date)`;
/** Đã quá hạn sử dụng */
export const expiredCond = sql`${items.expiresAt} is not null and ${items.expiresAt} < ${todayVN}`;
/** Hết hạn trong EXPIRING_DAYS ngày tới (chưa quá hạn) */
export const expiringCond = sql`${items.expiresAt} is not null and ${items.expiresAt} >= ${todayVN} and ${items.expiresAt} <= ${todayVN} + ${EXPIRING_DAYS}::int`;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function buildItemWhere(f: ItemFilters) {
  const userId = await uid();
  const conds: SQL[] = [liveItemOf(userId), ...inDomain(items.domain, f.domain)];
  if (f.ids) conds.push(inArray(items.id, f.ids.length ? f.ids : [-1]));
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
  if (f.stock === "expiring") conds.push(expiringCond);
  if (f.stock === "expired") conds.push(expiredCond);
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
    case "expiry":
      return [sql`${items.expiresAt} asc nulls last`, asc(items.name)];
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
      extras: { expiryDays: expiryDays.as("expiry_days") },
    }),
    db.select({ total: count() }).from(items).where(where),
  ]);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type ItemListRow = Awaited<ReturnType<typeof listItems>>["rows"][number];

/** Dùng cho export CSV / in nhãn: không phân trang (limit = chặn trên, nếu có) */
export async function listAllItems(f: ItemFilters, limit?: number) {
  const where = await buildItemWhere(f);
  return db.query.items.findMany({
    where,
    orderBy: orderFor(f.sort ?? "name"),
    limit,
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
    where: and(eq(items.id, id), liveItemOf(userId)),
    with: {
      category: true,
      location: true,
      media: { orderBy: [asc(media.sortOrder), asc(media.id)] },
    },
    extras: { expiryDays: expiryDays.as("expiry_days") },
  });
}

export type ItemDetail = NonNullable<Awaited<ReturnType<typeof getItem>>>;

export async function getItemMovements(itemId: number, limit = 50) {
  const userId = await uid();
  const rows = await db
    .select({ m: stockMovements })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .where(and(eq(stockMovements.itemId, itemId), liveItemOf(userId)))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(limit);
  return rows.map((r) => r.m);
}

/* ------------------------------------------------------------------ */
/* Lịch sử nhập / xuất                                                 */
/* ------------------------------------------------------------------ */

export async function listMovements(opts: { domain?: Domain; type?: MovementType; q?: string; page?: number }) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const conds: SQL[] = [liveItemOf(await uid()), ...inDomain(items.domain, opts.domain)];
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

export async function getDashboard(domain: Domain) {
  const userId = await uid();
  const mine = and(liveItemOf(userId), eq(items.domain, domain))!;
  const [[totals], byKind, byCategory, lowStock, recent, expiring] = await Promise.all([
    db
      .select({
        items: count(),
        value: sql<number>`coalesce(sum(${items.quantity} * coalesce(${items.unitPrice}, 0)), 0)::float8`,
        low: sql<number>`count(*) filter (where ${lowStockCond})::int`,
        out: sql<number>`count(*) filter (where ${outOfStockCond})::int`,
        expiring: sql<number>`count(*) filter (where ${expiringCond} and ${items.quantity} > 0)::int`,
        expired: sql<number>`count(*) filter (where ${expiredCond} and ${items.quantity} > 0)::int`,
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
      .leftJoin(items, and(eq(items.categoryId, categories.id), liveItem))
      .where(and(eq(categories.userId, userId), eq(categories.domain, domain)))
      .groupBy(categories.id, categories.name)
      .orderBy(desc(count(items.id)))
      .limit(8),
    db.query.items.findMany({
      where: and(mine, lowStockCond),
      orderBy: [asc(sql`${items.quantity} / nullif(${items.minQuantity}, 0)`), asc(items.name)],
      limit: 10,
      with: { cover: true, location: true },
      extras: { expiryDays: expiryDays.as("expiry_days") },
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
    // Sắp hết hạn / đã quá hạn (kho thực phẩm), còn hàng
    db.query.items.findMany({
      where: and(mine, gt(items.quantity, 0), sql`${items.expiresAt} is not null and ${items.expiresAt} <= ${todayVN} + ${EXPIRING_DAYS}::int`),
      orderBy: [asc(items.expiresAt), asc(items.name)],
      limit: 10,
      with: { cover: true, location: true },
      extras: { expiryDays: expiryDays.as("expiry_days") },
    }),
  ]);

  return { totals, byKind, byCategory, lowStock, recent, expiring };
}

export async function countLowStock(domain?: Domain) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(and(liveItemOf(await uid()), lowStockCond, ...inDomain(items.domain, domain)));
  return row?.n ?? 0;
}

/** Gợi ý cho ô nhập (nhà sản xuất, package, nhà cung cấp, tag) */
export async function getSuggestions(domain: Domain) {
  const userId = await uid();
  const distinct = (col: typeof items.manufacturer | typeof items.package | typeof items.supplier) =>
    db
      .selectDistinct({ v: sql<string>`${col}` })
      .from(items)
      .where(and(liveItemOf(userId), eq(items.domain, domain), sql`${col} is not null and ${col} <> ''`))
      .orderBy(sql`1`)
      .limit(200);
  const [manufacturers, packages, suppliers, tags] = await Promise.all([
    distinct(items.manufacturer),
    distinct(items.package),
    distinct(items.supplier),
    db.execute<{ tag: string }>(sql`select distinct unnest(${items.tags}) as tag from ${items} where ${items.userId} = ${userId} and ${items.domain} = ${domain} and ${items.deletedAt} is null order by 1 limit 300`),
  ]);
  return {
    manufacturers: manufacturers.map((r) => r.v!),
    packages: packages.map((r) => r.v!),
    suppliers: suppliers.map((r) => r.v!),
    tags: [...tags].map((r) => r.tag),
  };
}

/* ------------------------------------------------------------------ */
/* Quét mã                                                             */
/* ------------------------------------------------------------------ */

/** Mặt hàng có SKU hoặc MPN đúng bằng mã (không phân biệt hoa thường). SKU khớp được ưu tiên. */
export async function findItemsByCode(code: string, limit = 5) {
  const userId = await uid();
  const c = code.trim().toLowerCase();
  if (!c) return [];
  return db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(liveItemOf(userId), or(sql`lower(${items.sku}) = ${c}`, sql`lower(${items.mpn}) = ${c}`)))
    .orderBy(desc(sql`lower(coalesce(${items.sku}, '')) = ${c}`), asc(items.id))
    .limit(limit);
}

/** Vị trí có mã / nhãn dán đúng bằng mã (không phân biệt hoa thường). */
export async function findLocationByCode(code: string) {
  const userId = await uid();
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  const [row] = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.userId, userId), sql`lower(${locations.code}) = ${c}`))
    .limit(1);
  return row;
}

export async function getLocation(id: number) {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const userId = await uid();
  const [row] = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.id, id), eq(locations.userId, userId)));
  return row;
}
