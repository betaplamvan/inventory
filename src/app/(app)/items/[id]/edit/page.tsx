import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { ItemForm } from "@/components/item-form";
import { PageHeader, Skeleton } from "@/components/ui";
import { DomainSync } from "@/components/domain";
import { getCategoryTree, getItem, getLocationTree, getSuggestions } from "@/lib/queries";

export const metadata = { title: "Sửa mặt hàng" };

export default function EditItemPage(props: PageProps<"/items/[id]/edit">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<Skeleton className="h-[700px]" />}>
        <EditItem params={props.params} />
      </Suspense>
    </div>
  );
}

async function EditItem({ params }: { params: PageProps<"/items/[id]/edit">["params"] }) {
  const { id } = await params;
  const item = await getItem(Number(id));
  if (!item) notFound();
  // Danh mục / vị trí / gợi ý theo kho của chính mặt hàng này
  const [categories, locations, suggestions] = await Promise.all([
    getCategoryTree(item.domain),
    getLocationTree(item.domain),
    getSuggestions(item.domain),
  ]);
  const { category: _c, location: _l, media: _m, ...plain } = item;

  return (
    <>
      <PageHeader
        title="Sửa mặt hàng"
        description={item.name}
        back={
          <Link href={`/items/${item.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ChevronLeft className="size-4" /> Quay lại
          </Link>
        }
      />
      <DomainSync domain={item.domain} />
      <ItemForm
        domain={item.domain}
        item={plain}
        categories={categories}
        locations={locations}
        suggestions={suggestions}
      />
    </>
  );
}
