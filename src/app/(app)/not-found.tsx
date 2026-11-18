import Link from "next/link";
import { PackageX } from "lucide-react";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState icon={<PackageX className="size-10" />} title="Không tìm thấy trang hoặc mặt hàng">
      <Link href="/items" className="text-accent hover:underline">
        Quay lại kho hàng
      </Link>
    </EmptyState>
  );
}
