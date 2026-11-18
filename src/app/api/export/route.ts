import { type NextRequest, NextResponse } from "next/server";
import { listAllItems, type StockFilter } from "@/lib/queries";
import { getCurrentUser } from "@/lib/auth/session";
import { KIND_LABELS } from "@/lib/constants";
import type { ItemKind } from "@/db/schema";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Xuất danh sách (theo bộ lọc hiện tại) ra CSV, mở được bằng Excel. */
export async function GET(req: NextRequest) {
  if (!(await getCurrentUser())) return new NextResponse("Unauthorized", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const rows = await listAllItems({
    q: sp.get("q") || undefined,
    categoryId: Number(sp.get("category")) || undefined,
    locationId: Number(sp.get("location")) || undefined,
    kind: (sp.get("kind") as ItemKind) || undefined,
    stock: (sp.get("stock") as StockFilter) || undefined,
  });

  const header = [
    "ID", "Tên", "SKU", "Loại", "Danh mục", "Vị trí", "Hãng", "Mã nhà SX (MPN)", "Package",
    "Số lượng", "Đơn vị", "Tối thiểu", "Đơn giá", "Giá trị", "Nhà cung cấp", "Link mua",
    "Datasheet", "Tags", "Thông số", "Mô tả",
  ];
  const lines = rows.map((r) =>
    [
      r.id, r.name, r.sku, KIND_LABELS[r.kind], r.category?.name, r.location?.name, r.manufacturer,
      r.mpn, r.package, r.quantity, r.unit, r.minQuantity, r.unitPrice,
      r.unitPrice != null ? r.unitPrice * r.quantity : "", r.supplier, r.purchaseUrl,
      r.datasheetUrl, r.tags.join(", "), r.specs.map((s) => `${s.key}: ${s.value}`).join("; "),
      r.description,
    ]
      .map(csvCell)
      .join(","),
  );

  // BOM để Excel đọc đúng UTF-8 tiếng Việt
  const body = "﻿" + [header.join(","), ...lines].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kho-linh-kien-${date}.csv"`,
    },
  });
}
