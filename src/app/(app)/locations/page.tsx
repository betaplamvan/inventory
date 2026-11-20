import Link from "next/link";
import { Suspense } from "react";
import { QrCode } from "lucide-react";
import { deleteLocation, saveLocation } from "@/actions/taxonomy";
import { TaxonomyManager } from "@/components/taxonomy-manager";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { getLocationTree } from "@/lib/queries";

export const metadata = { title: "Vị trí cất" };

export default function LocationsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Vị trí cất"
        description="Tủ, kệ, hộp, ngăn… nơi bạn để đồ. Có thể lồng nhiều cấp (VD: Tủ A › Ngăn 3)"
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
  const nodes = await getLocationTree();
  return (
    <TaxonomyManager
      nodes={nodes}
      save={saveLocation}
      remove={deleteLocation}
      filterParam="location"
      withCode
      nounLabel="vị trí"
    />
  );
}
