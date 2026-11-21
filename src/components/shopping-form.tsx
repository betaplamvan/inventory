"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, Plus } from "lucide-react";
import { addShopping, type ShoppingState } from "@/actions/shopping";
import { SubmitButton } from "./confirm-button";

/** Thêm 1 món vào danh sách cần mua (form tự xoá trắng sau khi thêm) */
export function ShoppingAddForm({ units, placeholder }: { units: string[]; placeholder: string }) {
  const [state, action] = useActionState<ShoppingState, FormData>(addShopping, null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="card space-y-2 p-3" data-tour="shopping-add">
      <div className="grid grid-cols-[1fr_5rem_5.5rem] gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
        <input
          ref={nameRef}
          name="name"
          required
          maxLength={200}
          placeholder={placeholder}
          aria-label="Tên món cần mua"
          className="input col-span-3 sm:col-span-1"
        />
        <input
          name="quantity"
          inputMode="decimal"
          placeholder="SL"
          aria-label="Số lượng"
          className="input tabular-nums"
        />
        <input name="unit" list="shopping-units" placeholder="Đơn vị" aria-label="Đơn vị" className="input" />
        <datalist id="shopping-units">
          {units.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <SubmitButton className="btn-primary">
          <Plus className="size-4" /> Thêm
        </SubmitButton>
      </div>
      <input
        name="note"
        maxLength={500}
        placeholder="Ghi chú (tuỳ chọn): dùng cho món gì, mua ở đâu…"
        aria-label="Ghi chú"
        className="input"
      />
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

/** Chép danh sách dạng chữ (dán vào Zalo / Messenger khi đi chợ) */
export function CopyListButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
      {copied ? "Đã chép" : "Chép danh sách"}
    </button>
  );
}
