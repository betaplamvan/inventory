import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, type Domain, type Spec } from "@/db/schema";
import { DOMAIN_CONFIG } from "@/lib/domains";
import { ITEM_KINDS, KIND_LABELS } from "@/lib/constants";
import { parseCsv } from "@/lib/csv";
import { fmtQty, normalizeText } from "@/lib/format";
import { itemSchema, parseNum } from "@/lib/item-input";
import { InventoryError, createItemFor, pgErrorMessage, updateItemFor } from "./mutations";
import { RefNotFoundError, resolveRef } from "./refs";
import { liveItemOf } from "./scope";

/**
 * Nhập hàng loạt: từ CSV / bảng dán từ Excel (web) hoặc mảng dòng do agent gửi (MCP import_items).
 * Mỗi dòng: khớp mặt hàng đang có theo ID rồi SKU → cập nhật (chỉ các cột có giá trị), không khớp → thêm mới.
 * Chạy trong ngữ cảnh của user (cookie hoặc runAsUser) vì có tra cây danh mục / vị trí.
 */

export const MAX_IMPORT_ROWS = 2000;

/** Trường nào undefined = không có trong file → giữ giá trị cũ (cập nhật) hoặc dùng mặc định (thêm mới). */
export type ImportRow = {
  /** Số dòng trong file (hoặc thứ tự trong mảng), để báo lỗi */
  line: number;
  id?: number;
  name?: string;
  sku?: string | null;
  kind?: string;
  category?: number | string | null;
  location?: number | string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  package?: string | null;
  description?: string | null;
  specs?: Spec[];
  tags?: string[];
  unit?: string;
  quantity?: number;
  minQuantity?: number;
  unitPrice?: number | null;
  supplier?: string | null;
  purchaseUrl?: string | null;
  datasheetUrl?: string | null;
  notes?: string | null;
  /** Hạn sử dụng YYYY-MM-DD (thực phẩm) */
  expiresAt?: string | null;
  /** Lỗi phát hiện khi đọc ô (số sai, loại không hợp lệ…) */
  errors?: string[];
};

export type ImportOptions = {
  /** Kho nhận dữ liệu: mặt hàng mới thuộc kho này, danh mục / vị trí tra trong kho này */
  domain: Domain;
  /** Dòng khớp mặt hàng đang có (theo ID hoặc SKU): cập nhật hay bỏ qua */
  onExisting: "update" | "skip";
  /** Tự tạo danh mục / vị trí chưa có */
  createMissing: boolean;
  /** true = chỉ kiểm tra, không ghi gì */
  dryRun?: boolean;
  /** Ghi chú cho dòng kiểm kê khi số lượng thay đổi */
  adjustNote?: string;
};

export type ImportRowResult = {
  line: number;
  action: "create" | "update" | "skip" | "error";
  id?: number;
  name: string;
  sku: string | null;
  quantity?: number;
  messages: string[];
};

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: ImportRowResult[];
};

/* ------------------------------------------------------------------ */
/* CSV → dòng                                                          */
/* ------------------------------------------------------------------ */

type Field = Exclude<keyof ImportRow, "line" | "errors">;

/** Tên cột (đã bỏ dấu, chữ thường, bỏ ký tự đặc biệt) → trường. Khớp với tiêu đề của file xuất CSV. */
const HEADER_ALIASES: Record<string, Field | "ignore"> = {
  id: "id",
  "han su dung": "expiresAt",
  hsd: "expiresAt",
  "het han": "expiresAt",
  expiry: "expiresAt",
  "expiry date": "expiresAt",
  ten: "name",
  "ten mat hang": "name",
  "ten hang": "name",
  name: "name",
  sku: "sku",
  ma: "sku",
  "ma rieng": "sku",
  "ma hang": "sku",
  loai: "kind",
  kind: "kind",
  type: "kind",
  "danh muc": "category",
  category: "category",
  "vi tri": "location",
  "vi tri cat": "location",
  location: "location",
  hang: "manufacturer",
  "hang san xuat": "manufacturer",
  "nha san xuat": "manufacturer",
  manufacturer: "manufacturer",
  mpn: "mpn",
  "ma nha sx": "mpn",
  "ma nha sx mpn": "mpn",
  "ma nha san xuat": "mpn",
  "manufacturer part number": "mpn",
  "manufacture part number": "mpn",
  "part number": "mpn",
  package: "package",
  "kieu chan": "package",
  footprint: "package",
  "so luong": "quantity",
  sl: "quantity",
  "ton kho": "quantity",
  quantity: "quantity",
  qty: "quantity",
  "order qty": "quantity",
  "don vi": "unit",
  dvt: "unit",
  unit: "unit",
  "toi thieu": "minQuantity",
  "muc toi thieu": "minQuantity",
  min: "minQuantity",
  "min quantity": "minQuantity",
  "don gia": "unitPrice",
  gia: "unitPrice",
  "gia nhap": "unitPrice",
  "nha cung cap": "supplier",
  ncc: "supplier",
  supplier: "supplier",
  "link mua": "purchaseUrl",
  "link mua hang": "purchaseUrl",
  "purchase url": "purchaseUrl",
  datasheet: "datasheetUrl",
  "link datasheet": "datasheetUrl",
  tags: "tags",
  tag: "tags",
  "thong so": "specs",
  specs: "specs",
  "mo ta": "description",
  description: "description",
  "ghi chu": "notes",
  notes: "notes",
  note: "notes",
  // Cột tính toán của file xuất
  "gia tri": "ignore",
};

const normalizeHeader = (h: string) =>
  normalizeText(h)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Tiêu đề chuẩn — dùng chung cho file xuất, file mẫu và nhập lại (xuất → sửa trong Excel → nhập). */
export const CSV_HEADER = [
  "ID", "Tên", "SKU", "Loại", "Danh mục", "Vị trí", "Hãng", "Mã nhà SX (MPN)", "Package",
  "Số lượng", "Đơn vị", "Tối thiểu", "Đơn giá", "Giá trị", "Nhà cung cấp", "Link mua",
  "Datasheet", "Tags", "Thông số", "Mô tả", "Ghi chú", "Hạn sử dụng",
];

/** "24/11/2026" | "2026-11-24" | "24-11-2026" → "2026-11-24"; sai định dạng → null */
export function parseDateCell(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const kindByLabel = new Map<string, string>([
  ...ITEM_KINDS.map((k) => [normalizeText(k), k] as [string, string]),
  ...ITEM_KINDS.map((k) => [normalizeText(KIND_LABELS[k]), k] as [string, string]),
]);

function parseSpecs(s: string): Spec[] {
  return s
    .split(/[;\n]/)
    .map((part) => {
      const i = part.indexOf(":");
      return i < 0 ? { key: part.trim(), value: "" } : { key: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
    })
    .filter((x) => x.key || x.value);
}

export type CsvColumn = { header: string; field: Field | null };

/** Đọc CSV / TSV có dòng tiêu đề thành các ImportRow. Ô trống = không đổi. */
export function csvToRows(text: string): { rows: ImportRow[]; columns: CsvColumn[]; error?: string } {
  const lines = parseCsv(text);
  if (lines.length < 2) return { rows: [], columns: [], error: "File cần có dòng tiêu đề và ít nhất một dòng dữ liệu." };

  const mapped = lines[0].cells.map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? null);
  const columns: CsvColumn[] = lines[0].cells.map((header, i) => ({
    header,
    field: mapped[i] === "ignore" ? null : mapped[i],
  }));
  const fields = new Set(columns.map((c) => c.field));
  if (!fields.has("name") && !fields.has("mpn") && !fields.has("id") && !fields.has("sku")) {
    return {
      rows: [],
      columns,
      error: 'Không nhận ra dòng tiêu đề. Cần ít nhất một cột "Tên" (hoặc ID / SKU / MPN) — xem file mẫu.',
    };
  }
  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    return { rows: [], columns, error: `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập (file có ${lines.length - 1} dòng).` };
  }

  const rows: ImportRow[] = lines.slice(1).map(({ line, cells }) => {
    const row: ImportRow = { line };
    const errors: string[] = [];
    const num = (label: string, raw: string) => {
      const n = parseNum(raw);
      if (n == null || Number.isNaN(n)) errors.push(`${label} không hợp lệ: "${raw}"`);
      return n == null || Number.isNaN(n) ? undefined : n;
    };
    columns.forEach(({ field }, i) => {
      const raw = cells[i] ?? "";
      if (!field || raw === "") return;
      switch (field) {
        case "id": {
          const n = Number(raw);
          if (Number.isInteger(n) && n > 0) row.id = n;
          else errors.push(`ID không hợp lệ: "${raw}"`);
          break;
        }
        case "quantity":
          row.quantity = num("Số lượng", raw);
          break;
        case "minQuantity":
          row.minQuantity = num("Mức tối thiểu", raw);
          break;
        case "unitPrice":
          row.unitPrice = num("Đơn giá", raw);
          break;
        case "kind": {
          const k = kindByLabel.get(normalizeText(raw));
          if (k) row.kind = k;
          else errors.push(`Loại không hợp lệ: "${raw}" (dùng: ${ITEM_KINDS.map((x) => KIND_LABELS[x]).join(", ")})`);
          break;
        }
        case "specs":
          row.specs = parseSpecs(raw);
          break;
        case "expiresAt": {
          const d = parseDateCell(raw);
          if (d) row.expiresAt = d;
          else errors.push(`Hạn sử dụng không hợp lệ: "${raw}" (dùng dd/mm/yyyy)`);
          break;
        }
        case "tags":
          row.tags = [...new Set(raw.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean))];
          break;
        default:
          row[field] = raw;
      }
    });
    if (errors.length) row.errors = errors;
    return row;
  });
  return { rows, columns };
}

/* ------------------------------------------------------------------ */
/* Ghi                                                                 */
/* ------------------------------------------------------------------ */

const pick = <T,>(value: T | undefined, current: T): T => (value !== undefined ? value : current);

export async function importRows(userId: string, rows: ImportRow[], opts: ImportOptions): Promise<ImportResult> {
  if (rows.length > MAX_IMPORT_ROWS) throw new InventoryError(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập`);

  const refCache = new Map<string, { id: number | null; willCreate?: string }>();
  /** SKU đã gặp ở dòng trước trong cùng file (để xem trước báo đúng "cập nhật" thay vì "thêm mới" 2 lần) */
  const seenSku = new Map<string, number>();

  const resolve = async (kind: "category" | "location", value: number | string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return { id: null };
    const key = `${kind}:${typeof value === "number" ? `#${value}` : normalizeText(value)}`;
    let hit = refCache.get(key);
    if (!hit) {
      try {
        hit = { id: await resolveRef(kind, value, userId, opts.createMissing && !opts.dryRun, opts.domain) };
      } catch (err) {
        if (!(err instanceof RefNotFoundError)) throw err;
        const label = kind === "category" ? "danh mục" : "vị trí";
        if (!opts.createMissing) throw new InventoryError(`Chưa có ${label} "${value}" (bật "tự tạo" để thêm)`);
        hit = { id: null, willCreate: `Sẽ tạo ${label} "${value}"` };
      }
      refCache.set(key, hit);
    }
    return hit;
  };

  const out: ImportRowResult[] = [];
  for (const row of rows) {
    const res: ImportRowResult = {
      line: row.line,
      action: "error",
      name: row.name ?? row.mpn ?? "",
      sku: row.sku ?? null,
      quantity: row.quantity,
      messages: [...(row.errors ?? [])],
    };
    out.push(res);
    if (res.messages.length) continue;

    try {
      let target: typeof items.$inferSelect | undefined;
      if (row.id != null) {
        [target] = await db.select().from(items).where(and(eq(items.id, row.id), liveItemOf(userId)));
        if (!target) throw new InventoryError(`Không có mặt hàng ID=${row.id}`);
      } else if (row.sku) {
        [target] = await db.select().from(items).where(and(eq(items.sku, row.sku), liveItemOf(userId)));
      }
      if (target && target.domain !== opts.domain) {
        throw new InventoryError(
          `${row.id != null ? `ID=${row.id}` : `SKU "${row.sku}"`} thuộc ${DOMAIN_CONFIG[target.domain].space}, không phải ${DOMAIN_CONFIG[opts.domain].space}`,
        );
      }

      const dupLine = !target && row.sku ? seenSku.get(row.sku) : undefined;
      if (row.sku && !seenSku.has(row.sku)) seenSku.set(row.sku, row.line);
      const exists = !!target || dupLine != null;
      if (target) {
        res.id = target.id;
        res.name = row.name ?? target.name;
        res.sku = pick(row.sku, target.sku);
      }
      if (exists && opts.onExisting === "skip") {
        res.action = "skip";
        res.messages.push(target ? "Đã có trong kho — bỏ qua" : `Trùng SKU với dòng ${dupLine} — bỏ qua`);
        continue;
      }

      const [category, location] = [await resolve("category", row.category), await resolve("location", row.location)];
      for (const r of [category, location]) if (r?.willCreate) res.messages.push(r.willCreate);

      const cfg = DOMAIN_CONFIG[opts.domain];
      const parsed = itemSchema.safeParse({
        domain: opts.domain,
        name: (row.name ?? target?.name ?? row.mpn ?? "").trim(),
        sku: pick(row.sku, target?.sku ?? null) || null,
        kind: row.kind ?? target?.kind ?? cfg.defaultKind,
        categoryId: category ? category.id : (target?.categoryId ?? null),
        locationId: location ? location.id : (target?.locationId ?? null),
        manufacturer: pick(row.manufacturer, target?.manufacturer ?? null),
        mpn: pick(row.mpn, target?.mpn ?? null),
        package: pick(row.package, target?.package ?? null),
        description: pick(row.description, target?.description ?? null),
        specs: row.specs ?? target?.specs ?? [],
        tags: row.tags ?? target?.tags ?? [],
        unit: row.unit ?? target?.unit ?? cfg.defaultUnit,
        quantity: row.quantity ?? target?.quantity ?? 0,
        minQuantity: row.minQuantity ?? target?.minQuantity ?? 0,
        unitPrice: pick(row.unitPrice, target?.unitPrice ?? null),
        supplier: pick(row.supplier, target?.supplier ?? null),
        purchaseUrl: pick(row.purchaseUrl, target?.purchaseUrl ?? null),
        datasheetUrl: pick(row.datasheetUrl, target?.datasheetUrl ?? null),
        notes: pick(row.notes, target?.notes ?? null),
        expiresAt: pick(row.expiresAt, target?.expiresAt ?? null),
      });
      if (!parsed.success) {
        res.messages.push(...new Set(parsed.error.issues.map((i) => i.message)));
        continue;
      }
      const data = parsed.data;
      res.name = data.name;
      res.sku = data.sku;
      res.quantity = data.quantity;

      if (exists) {
        res.action = "update";
        if (target && data.quantity !== target.quantity) {
          res.messages.push(`Số lượng ${fmtQty(target.quantity)} → ${fmtQty(data.quantity)} (ghi là kiểm kê)`);
        }
        if (!target) res.messages.push(`Trùng SKU với dòng ${dupLine} — cập nhật dòng đó`);
        if (!opts.dryRun) {
          // Trùng SKU trong cùng file: dòng trước đã được tạo ở lượt ghi này → tìm lại
          const id =
            target?.id ??
            (await db.select({ id: items.id }).from(items).where(and(eq(items.sku, row.sku!), liveItemOf(userId))))[0]?.id;
          if (!id) throw new InventoryError(`Không tìm lại được mặt hàng SKU "${row.sku}"`);
          await updateItemFor(userId, id, data, opts.adjustNote ?? "Nhập từ CSV");
          res.id = id;
        }
      } else {
        res.action = "create";
        if (!opts.dryRun) res.id = await createItemFor(userId, data);
      }
    } catch (err) {
      res.action = "error";
      res.messages.push(pgErrorMessage(err));
    }
  }

  const count = (a: ImportRowResult["action"]) => out.filter((r) => r.action === a).length;
  return { created: count("create"), updated: count("update"), skipped: count("skip"), failed: count("error"), rows: out };
}
