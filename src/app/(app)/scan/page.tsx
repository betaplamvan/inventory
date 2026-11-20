import { Scanner } from "@/components/scanner";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Quét mã" };

export default function ScanPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Quét mã"
        description="Quét nhãn QR của kho, mã vạch SKU / MPN trên túi linh kiện, hoặc nhãn vị trí"
      />
      <Scanner />
    </div>
  );
}
