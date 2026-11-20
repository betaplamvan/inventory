import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { ImportForm } from "@/components/import-form";
import { PageHeader } from "@/components/ui";
import { MAX_IMPORT_ROWS } from "@/lib/inventory/import";

export const metadata = { title: "Nhập từ file" };

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Nhập từ CSV / Excel"
        description="Thêm hoặc cập nhật nhiều mặt hàng một lúc từ file CSV hoặc bảng dán từ Excel / Google Sheets"
        back={
          <Link href="/items" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ChevronLeft className="size-4" /> Kho hàng
          </Link>
        }
        actions={
          <a href="/api/export?template=1" className="btn-secondary btn-sm">
            <Download className="size-3.5" /> File mẫu
          </a>
        }
      />
      <div className="card mb-4 space-y-1.5 p-4 text-sm text-muted">
        <p>
          Dòng đầu là tiêu đề cột. Tên cột giống file <b className="text-foreground">Xuất CSV</b> (có dấu hay không dấu đều
          được): Tên, SKU, Loại, Danh mục, Vị trí, Hãng, MPN, Package, Số lượng, Đơn vị, Tối thiểu, Đơn giá, Nhà cung cấp, Link
          mua, Datasheet, Tags, Thông số, Mô tả, Ghi chú. Thiếu cột nào cũng được.
        </p>
        <p>
          Dòng có <b className="text-foreground">ID</b> hoặc <b className="text-foreground">SKU</b> trùng mặt hàng đang có sẽ
          được cập nhật (ô trống = giữ nguyên); còn lại là thêm mới. Danh mục / vị trí ghi dạng{" "}
          <span className="font-mono">Tụ điện &gt; Tụ gốm</span>. Tối đa {MAX_IMPORT_ROWS} dòng mỗi lần.
        </p>
        <p>Mẹo: Xuất CSV → sửa số lượng / giá trong Excel → nhập lại để cập nhật hàng loạt.</p>
      </div>
      <ImportForm />
    </div>
  );
}
