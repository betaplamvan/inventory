import Link from "next/link";
import { Suspense } from "react";
import { QrCode, Sparkles } from "lucide-react";
import { deleteLocation, saveLocation, seedDefaultLocations } from "@/actions/taxonomy";
import { SubmitButton } from "@/components/confirm-button";
import { TaxonomyManager } from "@/components/taxonomy-manager";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { getLocationTree } from "@/lib/queries";
import { currentDomain } from "@/lib/domain-server";
import { DOMAIN_CONFIG } from "@/lib/domains";

export const metadata = { title: "Vị trí cất" };

export default function LocationsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Vị trí cất"
        description="Tủ, kệ, hộp, ngăn… nơi bạn để đồ. Có thể lồng nhiều cấp (VD: Tủ A › Ngăn 3, Tủ lạnh › Ngăn mát)"
        tour="locations"
        actions={
          <Link
            href="/labels?locations=all"
            className="btn-secondary btn-sm"
            data-tour="loc-labels"
            title="In nhãn QR dán lên tủ / hộp: quét là ra danh sách đồ bên trong"
          >
            <QrCode className="size-3.5" /> In nhãn vị trí
          </Link>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <Locations />
      </Suspense>
    </div>
  );
}

async function Locations() {
  const domain = await currentDomain();
  const cfg = DOMAIN_CONFIG[domain];
  const nodes = await getLocationTree(domain);
  return (
    <>
      {nodes.length === 0 && (
        <form action={seedDefaultLocations} className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            {cfg.space} chưa có vị trí cất nào. Tạo nhanh: {cfg.locationPresets.map(([n]) => n).join(", ")}?
          </p>
          <SubmitButton className="btn-secondary">
            <Sparkles className="size-4" /> Tạo vị trí mẫu
          </SubmitButton>
        </form>
      )}
    <TaxonomyManager
      nodes={nodes}
      save={saveLocation}
      remove={deleteLocation}
      filterParam="location"
      withCode
      nounLabel="vị trí"
    />
    </>
  );
}
