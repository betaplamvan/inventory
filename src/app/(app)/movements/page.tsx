import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, Search } from "lucide-react";
import type { MovementType } from "@/db/schema";
import { MOVEMENT_LABELS, sourceLabel } from "@/lib/constants";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { listMovements } from "@/lib/queries";
import { EmptyState, ListSkeleton, MovementIcon, PageHeader, Pagination, qs } from "@/components/ui";

export const metadata = { title: "Nhập / Xuất" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default function MovementsPage(props: PageProps<"/movements">) {
  return (
    <>
      <PageHeader title="Lịch sử nhập / xuất" description="Mọi thay đổi số lượng trong kho" tour="movements" />
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
        <Form action="/movements" className="relative min-w-60 flex-1" data-tour="mv-search">
          {type && <input type="hidden" name="type" value={type} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input name="q" type="search" defaultValue={q} key={q} placeholder="Tìm theo mặt hàng, dự án, ghi chú…" className="input pl-9" enterKeyHint="search" />
        </Form>
        <div className="grid w-full grid-cols-4 rounded-lg border border-border bg-surface p-0.5 text-center text-sm sm:flex sm:w-auto" data-tour="mv-type">
          {([undefined, "in", "out", "adjust"] as const).map((t) => (
            <Link
              key={t ?? "all"}
              href={`/movements${qs({ q, type: t })}`}
              className={`rounded-md px-3 py-1.5 pointer-coarse:py-2 ${type === t ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:text-foreground"}`}
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
        <>
          <ul className="card divide-y divide-border md:hidden" data-tour="mv-list">
            {rows.map(({ movement: m, item }) => {
              const extra = [m.reference, m.note, m.unitPrice != null ? `${fmtMoney(m.unitPrice)}/${item.unit}` : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={m.id}>
                  <Link href={`/items/${item.id}`} className="flex items-start gap-3 p-3 active:bg-surface-2">
                    <MovementIcon type={m.type} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {MOVEMENT_LABELS[m.type]} · {fmtDateTime(m.createdAt)}
                        {sourceLabel(m) && ` · ${sourceLabel(m)}`}
                      </p>
                      {extra && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{extra}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-semibold tabular-nums ${m.delta < 0 ? "text-danger" : "text-accent-strong"}`}>
                        {m.delta > 0 ? "+" : ""}
                        {fmtQty(m.delta)} <span className="text-xs font-normal text-muted">{item.unit}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted tabular-nums">còn {fmtQty(m.balanceAfter)}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="card hidden overflow-x-auto md:block" data-tour="mv-list">
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
                    <td className="px-3 py-2 text-right whitespace-nowrap text-muted">
                      {fmtDateTime(m.createdAt)}
                      {sourceLabel(m) && (
                        <span className="ml-auto block max-w-40 truncate text-xs" title={sourceLabel(m) ?? undefined}>
                          {sourceLabel(m)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `/movements${qs({ q, type, page: p > 1 ? p : undefined })}`} />
    </>
  );
}
