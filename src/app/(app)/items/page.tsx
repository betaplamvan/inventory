import Link from "next/link";
import { Suspense } from "react";
import { Download, PackageSearch, Plus } from "lucide-react";
import { getCategoryTree, getLocationTree, listItems, type SortKey, type StockFilter } from "@/lib/queries";
import { fmtMoney } from "@/lib/format";
import type { ItemKind } from "@/db/schema";
import { ITEM_KINDS } from "@/lib/constants";
import { ItemsFilters, type FilterValues } from "@/components/items-filters";
import { QuickAdjust } from "@/components/quick-adjust";
import {
  EmptyState,
  ItemThumb,
  KindBadge,
  ListSkeleton,
  PageHeader,
  Pagination,
  Skeleton,
  StockStateBadge,
  qs,
} from "@/components/ui";

export const metadata = { title: "Kho hàng" };

export default function ItemsPage(props: PageProps<"/items">) {
  return (
    <>
      <PageHeader
        title="Kho hàng"
        description="Linh kiện, module, dụng cụ và vật tư đang có"
        actions={
          <Link href="/items/new" className="btn-primary">
            <Plus className="size-4" /> Thêm mặt hàng
          </Link>
        }
      />
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-4 h-36" />
            <ListSkeleton />
          </>
        }
      >
        <ItemsContent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function ItemsContent({ searchParams }: { searchParams: PageProps<"/items">["searchParams"] }) {
  const sp = await searchParams;
  const values: FilterValues = {
    q: one(sp.q),
    kind: one(sp.kind),
    category: one(sp.category),
    location: one(sp.location),
    stock: one(sp.stock),
    sort: one(sp.sort),
    view: one(sp.view),
  };
  const page = Number(one(sp.page)) || 1;

  const kind = ITEM_KINDS.includes(values.kind as ItemKind) ? (values.kind as ItemKind) : undefined;
  const [result, categories, locations] = await Promise.all([
    listItems({
      q: values.q,
      kind,
      categoryId: Number(values.category) || undefined,
      locationId: Number(values.location) || undefined,
      stock: values.stock as StockFilter,
      sort: values.sort as SortKey,
      page,
    }),
    getCategoryTree(),
    getLocationTree(),
  ]);

  const { rows, total, pageCount } = result;
  const filterQs = qs({ ...values, view: undefined });

  return (
    <>
      <ItemsFilters values={values} categories={categories} locations={locations} />

      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>{total} mặt hàng</span>
        <a href={`/api/export${filterQs}`} className="btn-ghost btn-sm">
          <Download className="size-3.5" /> Xuất CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<PackageSearch className="size-10" />} title="Không tìm thấy mặt hàng nào">
          Thử đổi từ khoá / bộ lọc, hoặc{" "}
          <Link href="/items/new" className="text-accent hover:underline">
            thêm mặt hàng mới
          </Link>
          .
        </EmptyState>
      ) : values.view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((it) => (
            <div key={it.id} className="card group flex flex-col overflow-hidden transition hover:border-accent/40">
              <Link href={`/items/${it.id}`} className="block flex-1">
                <ItemThumb cover={it.cover} className="aspect-square w-full rounded-none" iconClass="size-10" />
                <div className="space-y-1.5 p-3 pb-2">
                  <p className="line-clamp-2 text-sm font-medium group-hover:text-accent-strong">{it.name}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <KindBadge kind={it.kind} />
                    <StockStateBadge quantity={it.quantity} minQuantity={it.minQuantity} />
                  </div>
                  <p className="truncate text-xs text-muted">{it.location?.name ?? "Chưa có vị trí"}</p>
                </div>
              </Link>
              <div className="px-3 pb-3">
                <QuickAdjust itemId={it.id} quantity={it.quantity} minQuantity={it.minQuantity} unit={it.unit} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
              <Link href={`/items/${it.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <ItemThumb cover={it.cover} />
                <div className="min-w-0">
                  <p className="line-clamp-2 font-medium hover:text-accent-strong sm:truncate">{it.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <KindBadge kind={it.kind} />
                    <StockStateBadge quantity={it.quantity} minQuantity={it.minQuantity} />
                    {it.sku && <span className="font-mono">{it.sku}</span>}
                    {it.package && <span>{it.package}</span>}
                    {it.category && <span>{it.category.name}</span>}
                  </div>
                </div>
              </Link>
              <div className="hidden w-36 truncate text-sm text-muted md:block" title={it.location?.name}>
                {it.location?.name ?? "—"}
              </div>
              <div className="hidden w-28 text-right text-sm text-muted lg:block">{fmtMoney(it.unitPrice)}</div>
              <div className="ml-auto">
                <QuickAdjust itemId={it.id} quantity={it.quantity} minQuantity={it.minQuantity} unit={it.unit} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={result.page}
        pageCount={pageCount}
        hrefFor={(p) => `/items${qs({ ...values, page: p > 1 ? p : undefined })}`}
      />
    </>
  );
}
