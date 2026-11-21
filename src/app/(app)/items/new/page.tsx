import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { ItemForm } from "@/components/item-form";
import { PageHeader, Skeleton } from "@/components/ui";
import { currentDomain } from "@/lib/domain-server";
import { DOMAIN_CONFIG } from "@/lib/domains";
import { getCategoryTree, getLocationTree, getSuggestions } from "@/lib/queries";

export const metadata = { title: "Thêm mới" };

export default function NewItemPage(props: PageProps<"/items/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <NewItemForm searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function NewItemForm({ searchParams }: { searchParams: PageProps<"/items/new">["searchParams"] }) {
  const domain = await currentDomain();
  const sp = await searchParams;
  // ?name=…&quantity=…&unit=… — điền sẵn (vd. từ danh sách cần mua: "đã mua → thêm vào kho")
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 300) : undefined);
  const [categories, locations, suggestions] = await Promise.all([
    getCategoryTree(domain),
    getLocationTree(domain),
    getSuggestions(domain),
  ]);
  return (
    <>
      <PageHeader
        title={`Thêm ${DOMAIN_CONFIG[domain].noun}`}
        description={DOMAIN_CONFIG[domain].space}
        tour="new-item"
        back={
          <Link href="/items" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ChevronLeft className="size-4" /> Kho hàng
          </Link>
        }
      />
      <ItemForm
        domain={domain}
        categories={categories}
        locations={locations}
        suggestions={suggestions}
        prefill={{ name: one("name"), quantity: one("quantity"), unit: one("unit"), shoppingId: one("shopping") }}
      />
    </>
  );
}
