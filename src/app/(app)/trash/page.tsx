import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { Trash2 } from "lucide-react";
import { emptyTrash } from "@/actions/trash";
import { ConfirmButton } from "@/components/confirm-button";
import { TrashRowActions } from "@/components/trash-row-actions";
import { EmptyState, ItemThumb, ListSkeleton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { TRASH_DAYS, listTrashFor, purgeTrashFor } from "@/lib/inventory/trash";

export const metadata = { title: "Thùng rác" };

export default function TrashPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Thùng rác"
        tour="trash"
        description={`Mặt hàng đã xoá vẫn giữ ảnh và lịch sử, khôi phục được trong ${TRASH_DAYS} ngày. Sau đó sẽ tự xoá hẳn.`}
      />
      <Suspense fallback={<ListSkeleton />}>
        <Trash />
      </Suspense>
    </div>
  );
}

async function Trash() {
  const me = await requireUser();
  // Dọn món quá hạn sau khi trả trang (không làm chậm lần mở này)
  after(() => purgeTrashFor(me.id, "expired").catch((err) => console.error("[trash] lỗi dọn thùng rác:", err)));
  const rows = await listTrashFor(me.id);

  if (!rows.length) {
    return (
      <EmptyState icon={<Trash2 className="size-10" />} title="Thùng rác trống">
        Mặt hàng bị xoá (trên web hoặc qua agent) sẽ nằm ở đây.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2 text-sm text-muted">
        <span>{rows.length} mặt hàng</span>
        <form action={emptyTrash}>
          <ConfirmButton className="btn-ghost btn-sm hover:text-danger" message={`Xoá hẳn ${rows.length} mặt hàng cùng toàn bộ ảnh / video và lịch sử? Không thể hoàn tác.`}>
            <Trash2 className="size-3.5" /> Dọn sạch thùng rác
          </ConfirmButton>
        </form>
      </div>
      <ul className="card divide-y divide-border" data-tour="trash-list">
        {rows.map((it) => (
          <li key={it.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <ItemThumb cover={it.cover} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-medium sm:truncate">{it.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {it.sku && <span className="font-mono">{it.sku} · </span>}
                  {fmtQty(it.quantity)} {it.unit} · xoá {it.deletedAt ? fmtDateTime(it.deletedAt) : ""}
                  {it.deletedBy && ` · bởi ${it.deletedBy}`}
                </p>
              </div>
            </div>
            <TrashRowActions id={it.id} name={it.name} />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-xs text-muted">
        Mặt hàng trong thùng rác không hiện trong <Link href="/items" className="underline">Kho hàng</Link>, tổng quan, xuất CSV hay tool của agent.
      </p>
    </>
  );
}
