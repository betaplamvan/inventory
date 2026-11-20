import { type NextRequest, NextResponse } from "next/server";
import { getCategoryTree, getLocationTree, listAllItems, type StockFilter } from "@/lib/queries";
import { getCurrentUser } from "@/lib/auth/session";
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
    const example = (o: Record<string, unknown>) => CSV_HEADER.map((h) => o[h] ?? "");
    return csvResponse(
      toCsv([
        CSV_HEADER,
        example({
          Tên: "Tụ gốm 100nF 0805",
          SKU: "C-100N-0805",
          Loại: KIND_LABELS.component,
          "Danh mục": "Tụ điện > Tụ gốm",
          "Vị trí": "Tủ A > Ngăn 1",
          "Mã nhà SX (MPN)": "CL21B104KBCNNNC",
          Package: "0805",
          "Số lượng": 200,
          "Đơn vị": "cái",
          "Tối thiểu": 50,
          "Đơn giá": 150,
          "Nhà cung cấp": "LCSC",
          Tags: "smd, decoupling",
          "Thông số": "Điện dung: 100nF; Điện áp: 50V",
        }),
        example({
          Tên: "Mỏ hàn 60W",
          Loại: KIND_LABELS.tool,
          "Vị trí": "Kệ dụng cụ",
          "Số lượng": 1,
          "Đơn vị": "cái",
        }),
      ]),
      "mau-nhap-kho.csv",
    );
  }

  const [rows, categories, locations] = await Promise.all([
    listAllItems({
      q: sp.get("q") || undefined,
      categoryId: Number(sp.get("category")) || undefined,
      locationId: Number(sp.get("location")) || undefined,
      kind: (sp.get("kind") as ItemKind) || undefined,
      stock: (sp.get("stock") as StockFilter) || undefined,
    }),
    getCategoryTree(),
    getLocationTree(),
  ]);
  // Đường dẫn đầy đủ ("Tủ A > Ngăn 3") để nhập lại khớp đúng mục con khi có tên trùng
  const pathOf = (tree: { id: number; path: string }[], id: number | null) =>
    id == null ? "" : (tree.find((n) => n.id === id)?.path.replaceAll(" › ", " > ") ?? "");

  const lines = rows.map((r) => [
    r.id, r.name, r.sku, KIND_LABELS[r.kind], pathOf(categories, r.categoryId), pathOf(locations, r.locationId),
    r.manufacturer, r.mpn, r.package, r.quantity, r.unit, r.minQuantity, r.unitPrice,
    r.unitPrice != null ? r.unitPrice * r.quantity : "", r.supplier, r.purchaseUrl,
    r.datasheetUrl, r.tags.join(", "), r.specs.map((s) => `${s.key}: ${s.value}`).join("; "),
    r.description, r.notes,
  ]);

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv([CSV_HEADER, ...lines]), `kho-linh-kien-${date}.csv`);
}
