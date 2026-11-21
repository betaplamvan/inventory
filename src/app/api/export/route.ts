import { type NextRequest, NextResponse } from "next/server";
import { getCategoryTree, getLocationTree, listAllItems, type StockFilter } from "@/lib/queries";
import { getCurrentUser } from "@/lib/auth/session";
import { currentDomain } from "@/lib/domain-server";
import { DOMAIN_CONFIG, type Domain } from "@/lib/domains";

const FILE_SLUG: Record<Domain, string> = { electronics: "linh-kien", wardrobe: "quan-ao", pantry: "thuc-pham" };
import { KIND_LABELS } from "@/lib/constants";
import { toCsv } from "@/lib/csv";
import { CSV_HEADER } from "@/lib/inventory/import";
import type { ItemKind } from "@/db/schema";

const csvResponse = (body: string, filename: string) =>
  new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });

/**
 * Xuất danh sách (theo bộ lọc hiện tại) ra CSV, mở được bằng Excel.
 * Cùng tiêu đề cột với trang Nhập từ file → sửa trong Excel rồi nhập lại được (khớp theo cột ID).
 *   ?template=1 → file mẫu (tiêu đề + 2 dòng ví dụ)
 */
export async function GET(req: NextRequest) {
  if (!(await getCurrentUser())) return new NextResponse("Unauthorized", { status: 401 });
  const sp = req.nextUrl.searchParams;

  if (sp.has("template")) {
    // File mẫu theo kho đang chọn (linh kiện / quần áo / thực phẩm)
    const d = await currentDomain();
    const example = (o: Record<string, unknown>) => CSV_HEADER.map((h) => o[h] ?? "");
    return csvResponse(
      toCsv([CSV_HEADER, ...DOMAIN_CONFIG[d].importExample.rows.map(example)]),
      `mau-nhap-${FILE_SLUG[d]}.csv`,
    );
  }

  const domain = await currentDomain();
  const [rows, categories, locations] = await Promise.all([
    listAllItems({
      domain,
      q: sp.get("q") || undefined,
      categoryId: Number(sp.get("category")) || undefined,
      locationId: Number(sp.get("location")) || undefined,
      kind: (sp.get("kind") as ItemKind) || undefined,
      stock: (sp.get("stock") as StockFilter) || undefined,
    }),
    getCategoryTree(domain),
    getLocationTree(domain),
  ]);
  // Đường dẫn đầy đủ ("Tủ A > Ngăn 3") để nhập lại khớp đúng mục con khi có tên trùng
  const pathOf = (tree: { id: number; path: string }[], id: number | null) =>
    id == null ? "" : (tree.find((n) => n.id === id)?.path.replaceAll(" › ", " > ") ?? "");

  const lines = rows.map((r) => [
    r.id, r.name, r.sku, KIND_LABELS[r.kind], pathOf(categories, r.categoryId), pathOf(locations, r.locationId),
    r.manufacturer, r.mpn, r.package, r.quantity, r.unit, r.minQuantity, r.unitPrice,
    r.unitPrice != null ? r.unitPrice * r.quantity : "", r.supplier, r.purchaseUrl,
    r.datasheetUrl, r.tags.join(", "), r.specs.map((s) => `${s.key}: ${s.value}`).join("; "),
    r.description, r.notes, r.expiresAt ?? "",
  ]);

  const date = new Date().toISOString().slice(0, 10);
  // vd. kho-do-quan-ao-2026-11-21.csv
  return csvResponse(toCsv([CSV_HEADER, ...lines]), `kho-do-${FILE_SLUG[domain]}-${date}.csv`);
}
