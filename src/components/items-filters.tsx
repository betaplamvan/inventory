"use client";

import Form from "next/form";
import { useRef, useState } from "react";
import { LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { ITEM_KINDS, KIND_LABELS } from "@/lib/constants";

type Opt = { id: number; path: string; depth: number };

export type FilterValues = {
  q?: string;
  kind?: string;
  category?: string;
  location?: string;
  stock?: string;
  sort?: string;
  view?: string;
};

/** Nút đổi dạng danh sách / lưới — trên điện thoại đặt cạnh dòng "N mặt hàng" thay vì trong khung lọc. */
export function ViewToggle({ values, className = "" }: { values: FilterValues; className?: string }) {
  const view = values.view === "grid" ? "grid" : "list";
  return (
    <div className={`flex rounded-lg border border-border bg-surface p-0.5 ${className}`}>
      <ViewLink values={values} view="list" active={view === "list"} />
      <ViewLink values={values} view="grid" active={view === "grid"} />
    </div>
  );
}

export function ItemsFilters({
  values,
  categories,
  locations,
}: {
  values: FilterValues;
  categories: Opt[];
  locations: Opt[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();
  const hasFilter = !!(values.q || values.kind || values.category || values.location || values.stock);
  const view = values.view === "grid" ? "grid" : "list";
  // Điện thoại: các ô lọc thu gọn sau nút "Lọc" để danh sách hiện ngay ở màn hình đầu
  const [open, setOpen] = useState(false);
  const activeCount = [values.kind, values.category, values.location, values.stock, values.sort].filter(Boolean).length;

  return (
    <Form ref={formRef} action="/items" className="card mb-4 flex flex-col gap-3 p-3">
      <input type="hidden" name="view" value={view === "grid" ? "grid" : ""} />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={values.q}
            key={values.q ?? ""}
            placeholder="Tìm tên, mã, MPN, tag…"
            title="Tìm theo tên, mã, MPN, package, tag… (gõ không dấu cũng được)"
            className="input pl-9"
            type="search"
            enterKeyHint="search"
          />
        </div>
        <button type="submit" className="btn-primary max-md:hidden">
          Tìm
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Bộ lọc"
          className={`btn-secondary md:hidden ${open || activeCount ? "border-accent text-accent-strong" : ""}`}
        >
          <SlidersHorizontal className="size-4" />
          Lọc
          {activeCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
              {activeCount}
            </span>
          )}
        </button>
      </div>
      <div className={`grid-cols-2 gap-2 md:grid md:grid-cols-5 ${open ? "grid" : "hidden"}`}>
        <select name="kind" defaultValue={values.kind ?? ""} onChange={submit} className="input" key={`k${values.kind}`}>
          <option value="">Tất cả loại</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={values.category ?? ""}
          onChange={submit}
          className="input"
          key={`c${values.category}`}
        >
          <option value="">Tất cả danh mục</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {"  ".repeat(c.depth)}
              {c.path.split(" › ").pop()}
            </option>
          ))}
        </select>
        <select
          name="location"
          defaultValue={values.location ?? ""}
          onChange={submit}
          className="input"
          key={`l${values.location}`}
        >
          <option value="">Mọi vị trí</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {"  ".repeat(l.depth)}
              {l.path.split(" › ").pop()}
            </option>
          ))}
        </select>
        <select name="stock" defaultValue={values.stock ?? ""} onChange={submit} className="input" key={`s${values.stock}`}>
          <option value="">Mọi tình trạng</option>
          <option value="in">Còn hàng</option>
          <option value="low">Cần mua thêm</option>
          <option value="out">Hết hàng</option>
        </select>
        <select
          name="sort"
          defaultValue={values.sort ?? ""}
          onChange={submit}
          className="input col-span-2 md:col-span-1"
          key={`o${values.sort}`}
        >
          <option value="">Mới cập nhật</option>
          <option value="created">Mới thêm</option>
          <option value="name">Tên A → Z</option>
          <option value="qty">Số lượng ít nhất</option>
          <option value="value">Giá trị cao nhất</option>
        </select>
      </div>
      <div className={`items-center justify-between md:flex ${hasFilter ? "flex" : "hidden"}`}>
        {hasFilter ? (
          <Link href={view === "grid" ? "/items?view=grid" : "/items"} className="btn-ghost btn-sm">
            <X className="size-3.5" /> Xoá bộ lọc
          </Link>
        ) : (
          <span />
        )}
        <ViewToggle values={values} className="max-md:hidden" />
      </div>
    </Form>
  );
}

function ViewLink({ values, view, active }: { values: FilterValues; view: "list" | "grid"; active: boolean }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...values, view: view === "grid" ? "grid" : "" })) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  const Icon = view === "grid" ? LayoutGrid : List;
  return (
    <Link
      href={`/items${s ? `?${s}` : ""}`}
      aria-label={view === "grid" ? "Dạng lưới" : "Dạng danh sách"}
      className={`rounded-md p-1.5 pointer-coarse:p-2 ${active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
    >
      <Icon className="size-4" />
    </Link>
  );
}
