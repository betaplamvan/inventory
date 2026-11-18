import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { ItemForm } from "@/components/item-form";
import { PageHeader, Skeleton } from "@/components/ui";
import { getCategoryTree, getLocationTree, getSuggestions } from "@/lib/queries";

export const metadata = { title: "Thêm mặt hàng" };

export default function NewItemPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Thêm mặt hàng"
        back={
          <Link href="/items" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ChevronLeft className="size-4" /> Kho hàng
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <NewItemForm />
      </Suspense>
    </div>
  );
}

async function NewItemForm() {
  const [categories, locations, suggestions] = await Promise.all([
    getCategoryTree(),
    getLocationTree(),
    getSuggestions(),
  ]);
  return <ItemForm categories={categories} locations={locations} suggestions={suggestions} />;
}
