import { countLowStock } from "@/lib/queries";

export async function LowStockBadge() {
  const n = await countLowStock().catch(() => 0);
  if (!n) return null;
  return (
    <span
      title={`${n} mặt hàng sắp hết`}
      className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning"
    >
      {n}
    </span>
  );
}
