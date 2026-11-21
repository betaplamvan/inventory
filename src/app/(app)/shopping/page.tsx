import Link from "next/link";
import { Suspense } from "react";
import { Bot, Check, PackagePlus, Plus, RotateCcw, ShoppingCart, Trash2 } from "lucide-react";
import { addLowStockToShopping, clearDoneShopping, deleteShopping, toggleShopping } from "@/actions/shopping";
import { ConfirmButton, SubmitButton } from "@/components/confirm-button";
import { CopyListButton, ShoppingAddForm } from "@/components/shopping-form";
import { EmptyState, ListSkeleton, PageHeader, StockQty } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { currentDomain } from "@/lib/domain-server";
import { DOMAIN_CONFIG } from "@/lib/domains";
import { fmtQty } from "@/lib/format";
import { listShoppingFor } from "@/lib/inventory/shopping";
import { listItems } from "@/lib/queries";

export const metadata = { title: "Cần mua" };

export default function ShoppingPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Cần mua"
        description="Danh sách đi chợ của kho đang chọn — tự thêm, hoặc để trợ lý thêm khi gợi ý mạch, bộ phối, món ăn"
      />
      <Suspense fallback={<ListSkeleton />}>
        <Shopping />
      </Suspense>
    </div>
  );
}

const qtyText = (q: number | null, unit: string | null) => (q != null ? `${fmtQty(q)}${unit ? ` ${unit}` : ""}` : "");

async function Shopping() {
  const me = await requireUser();
  const domain = await currentDomain();
  const cfg = DOMAIN_CONFIG[domain];
  const [list, low] = await Promise.all([
    listShoppingFor(me.id, domain, { includeDone: true }),
    listItems({ domain, stock: "low", sort: "qty", pageSize: 30 }),
  ]);
  const pending = list.filter((s) => !s.done);
  const done = list.filter((s) => s.done);
  // Món dưới mức tối thiểu chưa có trong danh sách
  const listed = new Set(pending.map((s) => s.itemId).filter(Boolean));
  const lowNotListed = low.rows.filter((it) => !listed.has(it.id));
  const copyText = [
    `${cfg.space} — cần mua:`,
    ...pending.map(
      (s) =>
        `- ${s.name}${s.quantity != null ? ` (${qtyText(s.quantity, s.unit)})` : ""}${s.note ? ` — ${s.note}` : ""}`,
    ),
  ].join("\n");

  return (
    <div className="space-y-4">
      <ShoppingAddForm units={cfg.units} placeholder={`Thêm món cần mua cho ${cfg.space.toLowerCase()}…`} />

      <section className="card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Chưa mua <span className="font-normal text-muted">({pending.length})</span>
          </h2>
          {pending.length > 0 && <CopyListButton text={copyText} />}
        </div>
        {pending.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">
            <ShoppingCart className="mx-auto mb-2 size-8 opacity-50" />
            Chưa có gì cần mua.{" "}
            <Link href="/chat" className="text-accent-strong hover:underline">
              Hỏi trợ lý
            </Link>{" "}
            để brainstorm và nhờ thêm món còn thiếu.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name}
                    {s.quantity != null && (
                      <span className="ml-2 text-sm font-normal text-muted tabular-nums">
                        {qtyText(s.quantity, s.unit)}
                      </span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    {s.note && <span>{s.note}</span>}
                    {s.itemId && (
                      <Link href={`/items/${s.itemId}`} className="text-accent-strong hover:underline">
                        Đã có trong kho
                      </Link>
                    )}
                    {s.addedBy?.startsWith("agent") && (
                      <span className="inline-flex items-center gap-1">
                        <Bot className="size-3" /> trợ lý thêm
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {s.itemId ? (
                    <form action={toggleShopping.bind(null, s.id, true, true)}>
                      <SubmitButton className="btn-primary btn-sm">
                        <Check className="size-3.5" /> Đã mua
                        {s.quantity != null && s.quantity > 0 && ` · +${fmtQty(s.quantity)}`}
                      </SubmitButton>
                    </form>
                  ) : (
                    <>
                      <Link
                        href={`/items/new?${new URLSearchParams({
                          name: s.name,
                          ...(s.quantity != null ? { quantity: String(s.quantity) } : {}),
                          ...(s.unit ? { unit: s.unit } : {}),
                          shopping: String(s.id),
                        })}`}
                        className="btn-primary btn-sm"
                        title={`Đã mua: thêm vào ${cfg.space.toLowerCase()}`}
                      >
                        <PackagePlus className="size-3.5" /> Mua xong, thêm vào kho
                      </Link>
                      <form action={toggleShopping.bind(null, s.id, true, false)}>
                        <SubmitButton className="btn-secondary btn-sm">
                          <Check className="size-3.5" /> Đã mua
                        </SubmitButton>
                      </form>
                    </>
                  )}
                  <form action={deleteShopping.bind(null, s.id)}>
                    <button className="btn-ghost btn-sm hover:text-danger" aria-label={`Xoá ${s.name}`} title="Xoá">
                      <Trash2 className="size-3.5" />
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {lowNotListed.length > 0 && (
        <section className="card">
          <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">
            Dưới mức tối thiểu <span className="font-normal text-muted">— thêm vào danh sách?</span>
          </h2>
          <ul className="divide-y divide-border">
            {lowNotListed.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                <Link href={`/items/${it.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {it.name}
                </Link>
                <StockQty quantity={it.quantity} minQuantity={it.minQuantity} unit={it.unit} />
                <form
                  action={addLowStockToShopping.bind(null, {
                    id: it.id,
                    name: it.name,
                    quantity: Math.max(0, it.minQuantity - it.quantity),
                    unit: it.unit,
                  })}
                >
                  <SubmitButton className="btn-secondary btn-sm">
                    <Plus className="size-3.5" /> Cần mua
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <details className="card">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-semibold">
            <span>
              Đã mua <span className="font-normal text-muted">({done.length})</span>
            </span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {done.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted line-through">
                  {s.name} {qtyText(s.quantity, s.unit)}
                </span>
                <form action={toggleShopping.bind(null, s.id, false, false)}>
                  <button className="btn-ghost btn-sm" title="Chuyển lại thành chưa mua">
                    <RotateCcw className="size-3.5" /> Chưa mua
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={clearDoneShopping} className="border-t border-border px-4 py-2.5 text-right">
            <ConfirmButton className="btn-ghost btn-sm hover:text-danger" message="Xoá các món đã mua khỏi danh sách?">
              <Trash2 className="size-3.5" /> Xoá các món đã mua
            </ConfirmButton>
          </form>
        </details>
      )}

      {pending.length === 0 && lowNotListed.length === 0 && done.length === 0 && (
        <EmptyState icon={<ShoppingCart className="size-10" />} title={`${cfg.space}: không thiếu gì`}>
          Thêm món ở ô phía trên, hoặc đặt mức tối thiểu cho {cfg.noun} để app tự nhắc khi sắp hết.
        </EmptyState>
      )}
    </div>
  );
}
