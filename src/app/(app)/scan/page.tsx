import { Scanner } from "@/components/scanner";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Quét mã" };

export default function ScanPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Quét mã"
        tour="scan"
        description="Quét nhãn QR do app in, mã vạch SKU / MPN trên bao bì, hoặc nhãn vị trí cất"
      />
      <Scanner />
    </div>
  );
}
