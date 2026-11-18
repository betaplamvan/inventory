import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, Search } from "lucide-react";
import type { MovementType } from "@/db/schema";
import { MOVEMENT_LABELS } from "@/lib/constants";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { listMovements } from "@/lib/queries";
import { EmptyState, ListSkeleton, MovementIcon, PageHeader, Pagination, qs } from "@/components/ui";

export const metadata = { title: "Nhập / Xuất" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default function MovementsPage(props: PageProps<"/movements">) {
  return (
    <>
      <PageHeader title="Lịch sử nhập / xuất" description="Mọi thay đổi số lượng trong kho" />
      <Suspense fallback={<ListSkeleton rows={10} />}>
        <Movements searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Movements({ searchParams }: { searchParams: PageProps<"/movements">["searchParams"] }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const typeRaw = one(sp.type);
  const type = typeRaw && typeRaw in MOVEMENT_LABELS ? (typeRaw as MovementType) : undefined;
  const page = Number(one(sp.page)) || 1;
  const { rows, total, pageCount } = await listMovements({ q, type, page });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Form action="/movements" className="relative min-w-60 flex-1">
          {type && <input type="hidden" name="type" value={type} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input name="q" type="search" defaultValue={q} key={q} placeholder="Tìm theo mặt hàng, dự án, ghi chú…" className="input pl-9" />
        </Form>
        <div className="flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {([undefined, "in", "out", "adjust"] as const).map((t) => (
            <Link
              key={t ?? "all"}
              href={`/movements${qs({ q, type: t })}`}
              className={`rounded-md px-3 py-1.5 ${type === t ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {t ? MOVEMENT_LABELS[t] : "Tất cả"}
            </Link>
          ))}
        </div>
      </div>

      <p className="mb-3 text-sm text-muted">{total} giao dịch</p>

      {rows.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight className="size-10" />} title="Chưa có giao dịch nào" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Mặt hàng</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 text-right font-medium">Thay đổi</th>
                <th className="px-3 py-2 text-right font-medium">Còn lại</th>
                <th className="px-3 py-2 font-medium">Dự án / nguồn · ghi chú</th>
                <th className="px-3 py-2 text-right font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ movement: m, item }) => (
                <tr key={m.id} className="hover:bg-surface-2/50">
                  <td className="max-w-64 px-3 py-2">
                    <Link href={`/items/${item.id}`} className="block truncate font-medium hover:underline">
                      {item.name}
                    </Link>
                    {item.sku && <span className="font-mono text-xs text-muted">{item.sku}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <MovementIcon type={m.type} />
                      {MOVEMENT_LABELS[m.type]}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${m.delta < 0 ? "text-danger" : "text-accent-strong"}`}>
                    {m.delta > 0 ? "+" : ""}
                    {fmtQty(m.delta)} <span className="text-xs font-normal text-muted">{item.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtQty(m.balanceAfter)}</td>
                  <td className="max-w-72 px-3 py-2 text-muted">
                    <span className="line-clamp-2">
                      {[m.reference, m.note, m.unitPrice != null ? `${fmtMoney(m.unitPrice)}/${item.unit}` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted">{fmtDateTime(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `/movements${qs({ q, type, page: p > 1 ? p : undefined })}`} />
    </>
  );
}
