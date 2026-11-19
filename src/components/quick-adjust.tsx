"use client";

import { useOptimistic, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { quickAdjust } from "@/actions/items";
import { fmtQty } from "@/lib/format";
import { stockState } from "./ui";

export function QuickAdjust({
  itemId,
  quantity,
  minQuantity,
  unit,
  block = false,
}: {
  itemId: number;
  quantity: number;
  minQuantity: number;
  unit: string;
  /** Giãn hết chiều ngang, số lượng xếp trên đơn vị (thẻ hẹp ở dạng lưới) */
  block?: boolean;
}) {
  const [pending, start] = useTransition();
  const [qty, setQty] = useOptimistic(quantity);

  const change = (delta: number) => {
    if (qty + delta < 0) return;
    start(async () => {
      setQty((q) => q + delta);
      const res = await quickAdjust(itemId, delta);
      if (!res.ok) alert(res.error);
    });
  };

  const state = stockState(qty, minQuantity);
  const color = state === "out" ? "text-danger" : state === "low" ? "text-warning" : "text-foreground";

  const btn =
    "grid size-7 shrink-0 place-items-center rounded-md border border-border text-muted transition hover:bg-surface-2 hover:text-foreground active:scale-90 active:bg-surface-2 disabled:opacity-40 pointer-coarse:size-10 pointer-coarse:rounded-lg";

  return (
    <div className={block ? "flex w-full items-center justify-between gap-1" : "inline-flex items-center gap-1"}>
      <button type="button" onClick={() => change(-1)} disabled={pending || qty <= 0} className={btn} aria-label="Giảm 1">
        <Minus className="size-3.5 pointer-coarse:size-4" />
      </button>
      <span
        className={
          block ? "flex min-w-0 flex-col items-center leading-tight" : "min-w-14 text-center whitespace-nowrap"
        }
      >
        <span className={`font-semibold tabular-nums ${color}`}>{fmtQty(qty)}</span>{" "}
        <span className={`text-xs text-muted ${block ? "max-w-full truncate" : ""}`}>{unit}</span>
      </span>
      <button type="button" onClick={() => change(1)} disabled={pending} className={btn} aria-label="Tăng 1">
        <Plus className="size-3.5 pointer-coarse:size-4" />
      </button>
    </div>
  );
}
