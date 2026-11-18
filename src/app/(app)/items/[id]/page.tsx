import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft, Copy, ExternalLink, FileText, MapPin, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import { deleteItem, deleteMovement, duplicateItem } from "@/actions/items";
import { ConfirmButton } from "@/components/confirm-button";
import { MediaGallery } from "@/components/media-gallery";
import { MovementForm } from "@/components/movement-form";
import { KindBadge, MovementIcon, Skeleton, StockQty, StockStateBadge } from "@/components/ui";
import { MOVEMENT_LABELS } from "@/lib/constants";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { getCategoryTree, getItem, getItemMovements, getLocationTree } from "@/lib/queries";

export async function generateMetadata(props: PageProps<"/items/[id]">) {
  const { id } = await props.params;
  const item = await getItem(Number(id)).catch(() => undefined);
  return { title: item?.name ?? "Mặt hàng" };
}

export default function ItemPage(props: PageProps<"/items/[id]">) {
  return (
    <>
      <Link href="/items" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronLeft className="size-4" /> Kho hàng
      </Link>
      <Suspense
        fallback={
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Skeleton className="h-[500px]" />
            <Skeleton className="h-[400px]" />
          </div>
        }
      >
        <ItemDetail params={props.params} />
      </Suspense>
    </>
  );
}

async function ItemDetail({ params }: { params: PageProps<"/items/[id]">["params"] }) {
  const { id } = await params;
  const itemId = Number(id);
  const [item, movements, categories, locations] = await Promise.all([
    getItem(itemId),
    getItemMovements(itemId),
    getCategoryTree(),
    getLocationTree(),
  ]);
  if (!item) notFound();

  const categoryPath = categories.find((c) => c.id === item.categoryId)?.path;
  const locationPath = locations.find((l) => l.id === item.locationId)?.path;
  const value = item.unitPrice != null ? item.unitPrice * item.quantity : null;

  const specRows: [string, React.ReactNode][] = [
    ["Mã riêng (SKU)", item.sku && <span className="font-mono">{item.sku}</span>],
    ["Hãng sản xuất", item.manufacturer],
    ["MPN", item.mpn && <span className="font-mono">{item.mpn}</span>],
    ["Package", item.package],
    ...item.specs.map((s) => [s.key || "—", s.value] as [string, React.ReactNode]),
  ].filter(([, v]) => v) as [string, React.ReactNode][];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{item.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <KindBadge kind={item.kind} />
            <StockStateBadge quantity={item.quantity} minQuantity={item.minQuantity} />
            {categoryPath && (
              <Link href={`/items?category=${item.categoryId}`} className="hover:text-foreground hover:underline">
                {categoryPath}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/items/${item.id}/edit`} className="btn-secondary">
            <Pencil className="size-4" /> Sửa
          </Link>
          <form action={duplicateItem.bind(null, item.id)}>
            <button className="btn-secondary" title="Tạo mặt hàng tương tự">
              <Copy className="size-4" /> Nhân bản
            </button>
          </form>
          <form action={deleteItem.bind(null, item.id)}>
            <ConfirmButton message={`Xoá "${item.name}" cùng toàn bộ ảnh/video và lịch sử?`}>
              <Trash2 className="size-4" /> Xoá
            </ConfirmButton>
          </form>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Ảnh, video & tài liệu</h2>
            <MediaGallery
              itemId={item.id}
              coverId={item.coverMediaId}
              media={item.media.map((m) => ({
                id: m.id,
                kind: m.kind,
                filename: m.filename,
                size: m.size,
                thumbKey: m.thumbKey,
                contentType: m.contentType,
              }))}
            />
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Thông số</h2>
            {specRows.length === 0 ? (
              <p className="text-sm text-muted">Chưa có thông số.</p>
            ) : (
              <dl className="divide-y divide-border text-sm">
                {specRows.map(([k, v], i) => (
                  <div key={i} className="grid grid-cols-[minmax(110px,35%)_1fr] gap-3 py-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(item.datasheetUrl || item.purchaseUrl) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {item.datasheetUrl && (
                  <a href={item.datasheetUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                    <FileText className="size-3.5" /> Datasheet <ExternalLink className="size-3" />
                  </a>
                )}
                {item.purchaseUrl && (
                  <a href={item.purchaseUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                    <ShoppingCart className="size-3.5" /> Link mua hàng <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            )}
          </section>

          {(item.description || item.notes || item.tags.length > 0) && (
            <section className="card space-y-3 p-4 text-sm">
              {item.description && (
                <div>
                  <h2 className="mb-1 font-semibold">Mô tả</h2>
                  <p className="whitespace-pre-line text-muted">{item.description}</p>
                </div>
              )}
              {item.notes && (
                <div>
                  <h2 className="mb-1 font-semibold">Ghi chú</h2>
                  <p className="whitespace-pre-line text-muted">{item.notes}</p>
                </div>
              )}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/items?q=${encodeURIComponent(t)}`}
                      className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted hover:text-foreground"
                    >
                      #{t}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Lịch sử nhập / xuất</h2>
            {movements.length === 0 ? (
              <p className="text-sm text-muted">Chưa có giao dịch.</p>
            ) : (
              <ul className="divide-y divide-border">
                {movements.map((m) => (
                  <li key={m.id} className="group flex items-center gap-3 py-2.5 text-sm">
                    <MovementIcon type={m.type} />
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-medium">{MOVEMENT_LABELS[m.type]}</span>{" "}
                        <span className="tabular-nums">
                          {m.delta > 0 ? "+" : ""}
                          {fmtQty(m.delta)}
                        </span>{" "}
                        <span className="text-muted">→ còn {fmtQty(m.balanceAfter)}</span>
                      </p>
                      <p className="truncate text-xs text-muted">
                        {fmtDateTime(m.createdAt)}
                        {m.reference && ` · ${m.reference}`}
                        {m.note && ` · ${m.note}`}
                        {m.unitPrice != null && ` · ${fmtMoney(m.unitPrice)}/${item.unit}`}
                      </p>
                    </div>
                    <form action={deleteMovement.bind(null, m.id)} className="transition sm:opacity-0 sm:group-hover:opacity-100">
                      <ConfirmButton
                        message="Xoá dòng lịch sử này? (Không làm thay đổi số lượng tồn kho hiện tại)"
                        className="btn-ghost btn-sm"
                        title="Xoá dòng lịch sử"
                      >
                        <Trash2 className="size-3.5" />
                      </ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="card p-4">
            <p className="text-xs font-medium text-muted">Tồn kho hiện tại</p>
            <div className="mt-1">
              <StockQty quantity={item.quantity} minQuantity={item.minQuantity} unit={item.unit} size="lg" />
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Mức tối thiểu">{item.minQuantity > 0 ? `${fmtQty(item.minQuantity)} ${item.unit}` : "Không theo dõi"}</Row>
              <Row label="Đơn giá">{fmtMoney(item.unitPrice)}</Row>
              <Row label="Giá trị">{fmtMoney(value)}</Row>
              <Row label="Nhà cung cấp">{item.supplier ?? "—"}</Row>
              <Row label="Vị trí">
                {locationPath ? (
                  <Link href={`/items?location=${item.locationId}`} className="inline-flex items-center gap-1 hover:underline">
                    <MapPin className="size-3.5" /> {locationPath}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Cập nhật">{fmtDateTime(item.updatedAt)}</Row>
            </dl>
          </div>
          <MovementForm itemId={item.id} unit={item.unit} currentPrice={item.unitPrice} />
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
