import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { deleteCategory, saveCategory, seedDefaultCategories } from "@/actions/taxonomy";
import { SubmitButton } from "@/components/confirm-button";
import { TaxonomyManager } from "@/components/taxonomy-manager";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { getCategoryTree } from "@/lib/queries";
import { currentDomain } from "@/lib/domain-server";
import { DOMAIN_CONFIG } from "@/lib/domains";

export const metadata = { title: "Danh mục" };

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Danh mục"
        description="Phân nhóm đồ trong kho đang chọn, có thể lồng nhiều cấp (VD: Tụ điện › Tụ gốm, Áo › Sơ mi)"
        tour="categories"
      />
      <Suspense fallback={<ListSkeleton />}>
        <Categories />
      </Suspense>
    </div>
  );
}

async function Categories() {
  const domain = await currentDomain();
  const cfg = DOMAIN_CONFIG[domain];
  const nodes = await getCategoryTree(domain);
  return (
    <>
      {nodes.length === 0 && (
        <form action={seedDefaultCategories} className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4" data-tour="cat-seed">
          <p className="text-sm text-muted">
            {cfg.space} chưa có danh mục nào. Tạo nhanh bộ danh mục phổ biến (
            {cfg.categoryPresets
              .slice(0, 4)
              .map(([n]) => n.toLowerCase())
              .join(", ")}
            …)?
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
