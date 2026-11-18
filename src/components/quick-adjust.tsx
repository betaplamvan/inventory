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
}: {
  itemId: number;
  quantity: number;
  minQuantity: number;
  unit: string;
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

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => change(-1)}
        disabled={pending || qty <= 0}
        className="grid size-7 place-items-center rounded-md border border-border text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
        aria-label="Giảm 1"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-14 text-center">
        <span className={`font-semibold tabular-nums ${color}`}>{fmtQty(qty)}</span>{" "}
        <span className="text-xs text-muted">{unit}</span>
      </span>
      <button
        type="button"
        onClick={() => change(1)}
        disabled={pending}
        className="grid size-7 place-items-center rounded-md border border-border text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
        aria-label="Tăng 1"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
