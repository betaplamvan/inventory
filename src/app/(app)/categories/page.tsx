import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { deleteCategory, saveCategory, seedDefaultCategories } from "@/actions/taxonomy";
import { SubmitButton } from "@/components/confirm-button";
import { TaxonomyManager } from "@/components/taxonomy-manager";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { getCategoryTree } from "@/lib/queries";

export const metadata = { title: "Danh mục" };

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Danh mục" description="Phân loại linh kiện theo nhóm, có thể lồng nhiều cấp (VD: Tụ điện › Tụ gốm)" />
      <Suspense fallback={<ListSkeleton />}>
        <Categories />
      </Suspense>
    </div>
  );
}

async function Categories() {
  const nodes = await getCategoryTree();
  return (
    <>
      {nodes.length === 0 && (
        <form action={seedDefaultCategories} className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            Chưa có danh mục nào. Tạo nhanh bộ danh mục điện tử phổ biến (điện trở, tụ, IC, module, dụng cụ…)?
          </p>
          <SubmitButton className="btn-secondary">
            <Sparkles className="size-4" /> Tạo danh mục mẫu
          </SubmitButton>
        </form>
      )}
      <TaxonomyManager
        nodes={nodes}
        save={saveCategory}
        remove={deleteCategory}
        filterParam="category"
        nounLabel="danh mục"
      />
    </>
  );
}
