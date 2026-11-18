"use client";

import { useActionState, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { recordMovement, type ActionResult } from "@/actions/items";
import type { MovementType } from "@/db/schema";
import { SubmitButton } from "./confirm-button";

const TABS: { type: MovementType; label: string; icon: typeof ArrowDownLeft; hint: string }[] = [
  { type: "in", label: "Nhập", icon: ArrowDownLeft, hint: "Số lượng mua thêm / nhận thêm" },
  { type: "out", label: "Xuất", icon: ArrowUpRight, hint: "Số lượng lấy ra dùng / cho / hỏng" },
  { type: "adjust", label: "Kiểm kê", icon: RefreshCw, hint: "Số lượng thực tế đếm được" },
];

export function MovementForm({ itemId, unit, currentPrice }: { itemId: number; unit: string; currentPrice: number | null }) {
  const [type, setType] = useState<MovementType>("out");
  const [state, action] = useActionState<ActionResult | null, FormData>(
    recordMovement.bind(null, itemId),
    null,
  );
  const tab = TABS.find((t) => t.type === type)!;

  return (
    <div className="card p-4">
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
        {TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setType(t.type)}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition ${
              type === t.type ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="type" value={type} />
        <div>
          <label className="label">
            {tab.hint} ({unit})
          </label>
          <input name="amount" inputMode="decimal" required className="input text-lg tabular-nums" placeholder="0" />
        </div>
        {type === "in" && (
          <div>
            <label className="label">Đơn giá nhập (₫) — để trống nếu không đổi</label>
            <input
              name="unitPrice"
              inputMode="decimal"
              className="input tabular-nums"
              placeholder={currentPrice != null ? String(currentPrice) : ""}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">{type === "in" ? "Nguồn / đơn hàng" : "Dự án / lý do"}</label>
            <input name="reference" className="input" placeholder={type === "in" ? "Đơn banlinhkien…" : "Mạch đèn LED…"} />
          </div>
          <div>
            <label className="label">Ghi chú</label>
            <input name="note" className="input" />
          </div>
        </div>
        {state && (
          <p className={`text-sm ${state.ok ? "text-accent-strong" : "text-danger"}`}>
            {state.ok ? state.message : state.error}
          </p>
        )}
        <SubmitButton className="btn-primary w-full">Xác nhận {tab.label.toLowerCase()}</SubmitButton>
      </form>
    </div>
  );
}
