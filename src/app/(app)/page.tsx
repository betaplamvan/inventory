import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Boxes, PackageX, Plus, Wallet } from "lucide-react";
import { getDashboard } from "@/lib/queries";
import { KIND_LABELS, MOVEMENT_LABELS } from "@/lib/constants";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { EmptyState, ItemThumb, MovementIcon, PageHeader, Skeleton, StockQty } from "@/components/ui";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Tổng quan"
        description="Tình trạng kho linh kiện, dụng cụ và vật tư của bạn"
        tour="home"
        actions={
          <Link href="/items/new" className="btn-primary max-lg:hidden">
            <Plus className="size-4" /> Thêm mặt hàng
          </Link>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={`h-20 sm:h-24 ${i === 1 ? "max-lg:order-last max-lg:col-span-3" : ""}`} />
        ))}
      </div>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  href,
  tone = "default",
  className = "",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  href?: string;
  tone?: "default" | "warning" | "danger";
  className?: string;
}) {
  const toneCls =
    tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground";
  const body = (
    <div className="card h-full p-3 transition hover:border-accent/40 sm:p-4">
      <div className="flex items-center justify-between gap-1 text-muted">
        <span className="truncate text-xs font-medium">{label}</span>
        <span className="shrink-0">{icon}</span>
      </div>
      <div className={`mt-1.5 truncate text-2xl font-semibold tabular-nums sm:mt-2 sm:text-3xl ${toneCls}`}>{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} className={`min-w-0 ${className}`}>
      {body}
    </Link>
  ) : (
    <div className={`min-w-0 ${className}`}>{body}</div>
  );
}

async function Dashboard() {
  const { totals, byKind, byCategory, lowStock, recent } = await getDashboard();

  if (totals.items === 0) {
    return (
      <div data-tour="home-empty">
      <EmptyState icon={<Boxes className="size-10" />} title="Kho đang trống">
        <p>Bắt đầu bằng cách tạo danh mục, vị trí cất và thêm mặt hàng đầu tiên.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/items/new" className="btn-primary">
            <Plus className="size-4" /> Thêm mặt hàng
          </Link>
          <Link href="/categories" className="btn-secondary">
            Tạo danh mục
          </Link>
        </div>
      </EmptyState>
      </div>
    );
  }

  const maxCat = Math.max(1, ...byCategory.map((c) => c.n));

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Điện thoại: 3 ô đếm trên một hàng, ô giá trị (số dài) nằm trọn một hàng bên dưới */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-4" data-tour="home-stats">
        <StatTile label="Mặt hàng" value={fmtQty(totals.items)} icon={<Boxes className="size-4" />} href="/items" />
        <StatTile
          label="Giá trị kho ước tính"
          value={fmtMoney(totals.value)}
          icon={<Wallet className="size-4" />}
          className="max-lg:order-last max-lg:col-span-3"
        />
        <StatTile
          label="Sắp hết"
          value={fmtQty(totals.low)}
          icon={<AlertTriangle className="size-4" />}
          href="/items?stock=low"
          tone={totals.low > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Hết hàng"
          value={fmtQty(totals.out)}
          icon={<PackageX className="size-4" />}
          href="/items?stock=out"
          tone={totals.out > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <section className="card min-w-0 p-4" data-tour="home-low">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Cần mua thêm</h2>
            <Link href="/items?stock=low" className="-my-2 py-2 text-xs text-accent-strong hover:underline">
              Xem tất cả
            </Link>
          </div>
          {lowStock.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Không có mặt hàng nào dưới mức tối thiểu 🎉</p>
          ) : (
            <ul className="divide-y divide-border">
              {lowStock.map((it) => (
                <li key={it.id}>
                  <Link href={`/items/${it.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                    <ItemThumb cover={it.cover} className="size-10" iconClass="size-4" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.name}</p>
                      <p className="truncate text-xs text-muted">
                        Tối thiểu {fmtQty(it.minQuantity)} {it.unit}
                        {it.location && ` · ${it.location.name}`}
                      </p>
                    </div>
                    <StockQty quantity={it.quantity} minQuantity={it.minQuantity} unit={it.unit} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Nhập / xuất gần đây</h2>
            <Link href="/movements" className="-my-2 py-2 text-xs text-accent-strong hover:underline">
              Xem lịch sử
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Chưa có giao dịch nào</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map(({ movement: m, item }) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <MovementIcon type={m.type} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/items/${item.id}`} className="block truncate text-sm font-medium hover:underline">
                      {item.name}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {MOVEMENT_LABELS[m.type]} · {fmtDateTime(m.createdAt)}
                      {m.reference && ` · ${m.reference}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {m.delta > 0 ? "+" : ""}
                    {fmtQty(m.delta)} <span className="text-xs font-normal text-muted">{item.unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-4">
          <h2 className="mb-1 font-semibold">Số mặt hàng theo danh mục</h2>
          <p className="mb-4 text-xs text-muted">8 danh mục nhiều mặt hàng nhất</p>
          {byCategory.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Chưa có danh mục</p>
          ) : (
            <ul className="space-y-2.5">
              {byCategory.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/items?category=${c.id}`}
                    className="group block"
                    title={`${c.name}: ${c.n} mặt hàng · ${fmtMoney(c.value)}`}
                  >
                    <div className="mb-1 flex justify-between gap-3 text-sm">
                      <span className="truncate group-hover:underline">{c.name}</span>
                      <span className="tabular-nums text-muted">{c.n}</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2">
                      <div
                        className="h-2 rounded-full bg-accent transition group-hover:bg-accent-hover"
                        style={{ width: `${Math.max(2, (c.n / maxCat) * 100)}%` }}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-4">
          <h2 className="mb-4 font-semibold">Theo loại</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {byKind.map((k) => (
              <Link
                key={k.kind}
                href={`/items?kind=${k.kind}`}
                className="rounded-lg border border-border p-3 transition hover:border-accent/40"
              >
                <p className="text-xs text-muted">{KIND_LABELS[k.kind]}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{k.n}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
