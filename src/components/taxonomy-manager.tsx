"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ActionResult } from "@/actions/items";
import { ConfirmButton, SubmitButton } from "./confirm-button";

export type TaxNode = {
  id: number;
  name: string;
  parentId: number | null;
  description: string | null;
  code?: string | null;
  sortOrder?: number;
  depth: number;
  path: string;
  itemCount: number;
};

type SaveAction = (id: number | null, prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function TaxonomyManager({
  nodes,
  save,
  remove,
  filterParam,
  withCode = false,
  nounLabel,
}: {
  nodes: TaxNode[];
  save: SaveAction;
  remove: (id: number) => Promise<void>;
  filterParam: "category" | "location";
  withCode?: boolean;
  nounLabel: string;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(nodes.length === 0 ? "new" : null);
  const [addParent, setAddParent] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {editing === "new" ? (
        <NodeForm
          nodes={nodes}
          save={save}
          withCode={withCode}
          defaultParent={addParent}
          title={`Thêm ${nounLabel}`}
          onDone={() => {
            setEditing(null);
            setAddParent(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="btn-primary"
          data-tour="tax-add"
          onClick={() => {
            setAddParent(null);
            setEditing("new");
          }}
        >
          <Plus className="size-4" /> Thêm {nounLabel}
        </button>
      )}

      {nodes.length > 0 && (
        <ul className="card divide-y divide-border" data-tour="tax-list">
          {nodes.map((n) =>
            editing === n.id ? (
              <li key={n.id} className="p-3">
                <NodeForm
                  node={n}
                  nodes={nodes}
                  save={save}
                  withCode={withCode}
                  title={`Sửa: ${n.name}`}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={n.id} className="group flex items-center gap-1 py-1.5 pr-1.5 pl-3 sm:gap-2 sm:px-3 sm:py-2.5">
                <div
                  className="flex min-w-0 flex-1 items-center gap-1.5 pl-[calc(var(--depth)*0.875rem)] sm:pl-[calc(var(--depth)*1.25rem)]"
                  style={{ "--depth": n.depth } as React.CSSProperties}
                >
                  {n.depth > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted/60" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {n.name}
                      {n.code && <span className="ml-2 font-mono text-xs text-muted">[{n.code}]</span>}
                    </p>
                    {n.description && <p className="truncate text-xs text-muted">{n.description}</p>}
                  </div>
                </div>
                <Link
                  href={`/items?${filterParam}=${n.id}`}
                  className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted tabular-nums hover:text-foreground"
                  title="Xem mặt hàng"
                  aria-label={`${n.itemCount} mặt hàng`}
                >
                  {n.itemCount}
                  <span className="max-sm:hidden"> mặt hàng</span>
                </Link>
                <div className="flex shrink-0 gap-0.5 transition group-hover:opacity-100 focus-within:opacity-100 can-hover:opacity-0">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    title={`Thêm ${nounLabel} con`}
                    onClick={() => {
                      setAddParent(n.id);
                      setEditing("new");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <button type="button" className="btn-ghost btn-sm" title="Sửa" onClick={() => setEditing(n.id)}>
                    <Pencil className="size-3.5" />
                  </button>
                  <form action={remove.bind(null, n.id)}>
                    <ConfirmButton
                      className="btn-ghost btn-sm hover:text-danger"
                      title="Xoá"
                      message={`Xoá "${n.name}"? Các mặt hàng bên trong sẽ không bị xoá mà chuyển thành "chưa phân loại"; mục con sẽ lên cấp gốc.`}
                    >
                      <Trash2 className="size-3.5" />
                    </ConfirmButton>
                  </form>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function NodeForm({
  node,
  nodes,
  save,
  withCode,
  defaultParent,
  title,
  onDone,
}: {
  node?: TaxNode;
  nodes: TaxNode[];
  save: SaveAction;
  withCode: boolean;
  defaultParent?: number | null;
  title: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(save.bind(null, node?.id ?? null), null);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" onClick={onDone} className="-m-2 p-2 text-muted hover:text-foreground" aria-label="Đóng">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Tên *</label>
          <input name="name" defaultValue={node?.name} required autoFocus className="input" />
        </div>
        <div>
          <label className="label">Thuộc mục cha</label>
          <select name="parentId" defaultValue={node?.parentId ?? defaultParent ?? ""} className="input">
            <option value="">— Cấp gốc —</option>
            {nodes
              .filter((n) => n.id !== node?.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.path}
                </option>
              ))}
          </select>
        </div>
        {withCode ? (
          <div>
            <label className="label">Mã / nhãn dán</label>
            <input name="code" defaultValue={node?.code ?? ""} className="input font-mono" placeholder="A1-03" />
          </div>
        ) : (
          <div>
            <label className="label">Thứ tự hiển thị</label>
            <input name="sortOrder" type="number" defaultValue={node?.sortOrder ?? 0} className="input" />
          </div>
        )}
        <div>
          <label className="label">Mô tả</label>
          <input name="description" defaultValue={node?.description ?? ""} className="input" />
        </div>
      </div>
      {state && !state.ok && <p className="text-sm text-danger">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-secondary">
          Huỷ
        </button>
        <SubmitButton>{node ? "Lưu" : "Thêm"}</SubmitButton>
      </div>
    </form>
  );
}
