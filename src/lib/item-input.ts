import { z } from "zod";
import { ITEM_KINDS } from "./constants";
import { DOMAINS, DOMAIN_CONFIG, kindAllowed, type Domain } from "./domains";
import { normalizeText } from "./format";
import type { ItemKind, Spec } from "@/db/schema";

const str = (s: FormDataEntryValue | null) => (typeof s === "string" ? s.trim() : "");
const optStr = (s: FormDataEntryValue | null) => str(s) || null;

/** "1.234,5" | "1234.5" | "1,5" -> number */
export function parseNum(v: FormDataEntryValue | null | undefined): number | null {
  const s = typeof v === "string" ? v.trim().replace(/\s/g, "") : "";
  if (!s) return null;
  let t = s;
  if (/^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) {
    // Kiểu Việt Nam: 12.000 | 1.234.567,5  (dấu chấm = phân cách hàng nghìn)
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
    // Kiểu quốc tế: 12,000 | 1,234,567.5
    t = t.replace(/,/g, "");
  } else {
    t = t.replace(",", "."); // 0,5 -> 0.5
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const num = (label: string, opts: { min?: number } = {}) =>
  z
    .number({ error: `${label} không hợp lệ` })
    .refine((n) => !Number.isNaN(n), `${label} không hợp lệ`)
    .refine((n) => opts.min == null || n >= opts.min, `${label} phải ≥ ${opts.min}`);

const url = z
  .string()
  .nullable()
  .refine((s) => !s || /^https?:\/\//i.test(s), "Link phải bắt đầu bằng http:// hoặc https://");

export const itemSchema = z
  .object({
  domain: z.enum(DOMAINS as [Domain, ...Domain[]]),
  name: z.string().min(1, "Vui lòng nhập tên").max(300),
  sku: z.string().max(100).nullable(),
  kind: z.enum(ITEM_KINDS as [string, ...string[]]),
  categoryId: z.number().int().positive().nullable(),
  locationId: z.number().int().positive().nullable(),
  manufacturer: z.string().max(200).nullable(),
  mpn: z.string().max(200).nullable(),
  package: z.string().max(100).nullable(),
  description: z.string().max(10000).nullable(),
  specs: z.array(z.object({ key: z.string(), value: z.string() })),
  tags: z.array(z.string()),
  unit: z.string().min(1).max(30),
  quantity: num("Số lượng", { min: 0 }),
  minQuantity: num("Mức tối thiểu", { min: 0 }),
  unitPrice: num("Đơn giá", { min: 0 }).nullable(),
  supplier: z.string().max(200).nullable(),
  purchaseUrl: url,
  datasheetUrl: url,
  notes: z.string().max(10000).nullable(),
  /** Hạn sử dụng YYYY-MM-DD (kho thực phẩm) */
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Hạn sử dụng phải có dạng YYYY-MM-DD")
    .nullable(),
  })
  .refine((v) => kindAllowed(v.domain, v.kind as ItemKind), {
    path: ["kind"],
    message: "Loại này không thuộc kho đang chọn",
  });

export type ItemInput = z.infer<typeof itemSchema>;

export function itemFromFormData(fd: FormData) {
  const keys = fd.getAll("specKey").map(str);
  const values = fd.getAll("specValue").map(str);
  const specs: Spec[] = keys
    .map((key, i) => ({ key, value: values[i] ?? "" }))
    .filter((s) => s.key || s.value);

  const tags = [
    ...new Set(
      str(fd.get("tags"))
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];

  const id = (v: FormDataEntryValue | null) => {
    const n = Number(str(v));
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const domain = (str(fd.get("domain")) || "electronics") as Domain;
  return itemSchema.safeParse({
    domain,
    name: str(fd.get("name")),
    sku: optStr(fd.get("sku")),
    kind: str(fd.get("kind")) || DOMAIN_CONFIG[domain]?.defaultKind || "other",
    categoryId: id(fd.get("categoryId")),
    locationId: id(fd.get("locationId")),
    manufacturer: optStr(fd.get("manufacturer")),
    mpn: optStr(fd.get("mpn")),
    package: optStr(fd.get("package")),
    description: optStr(fd.get("description")),
    specs,
    tags,
    unit: str(fd.get("unit")) || DOMAIN_CONFIG[domain]?.defaultUnit || "cái",
    quantity: parseNum(fd.get("quantity")) ?? 0,
    minQuantity: parseNum(fd.get("minQuantity")) ?? 0,
    unitPrice: parseNum(fd.get("unitPrice")),
    supplier: optStr(fd.get("supplier")),
    purchaseUrl: optStr(fd.get("purchaseUrl")),
    datasheetUrl: optStr(fd.get("datasheetUrl")),
    notes: optStr(fd.get("notes")),
    expiresAt: optStr(fd.get("expiresAt")),
  });
}

export function buildSearchText(i: {
  name: string;
  sku?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  package?: string | null;
  description?: string | null;
  supplier?: string | null;
  tags?: string[];
  specs?: Spec[];
}) {
  return normalizeText(
    [
      i.name,
      i.sku,
      i.manufacturer,
      i.mpn,
      i.package,
      i.supplier,
      ...(i.tags ?? []),
      ...(i.specs ?? []).flatMap((s) => [s.key, s.value]),
      i.description,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "_");
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}
