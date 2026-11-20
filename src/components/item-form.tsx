"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { createItem, updateItem } from "@/actions/items";
import type { Item, ItemKind, Spec } from "@/db/schema";
import { ITEM_KINDS, KIND_LABELS, UNITS } from "@/lib/constants";
import { fmtBytes } from "@/lib/format";
import { ACCEPT_MEDIA, uploadFile } from "@/lib/upload-client";

type Opt = { id: number; path: string };

const SPEC_PRESETS: Partial<Record<ItemKind, string[]>> = {
  component: ["Giá trị", "Điện áp", "Dòng", "Công suất", "Sai số"],
  module: ["Điện áp hoạt động", "Giao tiếp", "Kích thước", "Chip chính"],
  tool: ["Công suất", "Kích thước", "Nguồn"],
  consumable: ["Đường kính", "Thành phần", "Khối lượng"],
  equipment: ["Dải đo", "Độ chính xác", "Nguồn"],
};

type Suggestions = { manufacturers: string[]; packages: string[]; suppliers: string[]; tags: string[] };

export function ItemForm({
  item,
  categories,
  locations,
  suggestions,
}: {
  item?: Item;
  categories: Opt[];
  locations: Opt[];
  suggestions: Suggestions;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "component");
  const [specs, setSpecs] = useState<Spec[]>(item?.specs?.length ? item.specs : [{ key: "", value: "" }]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const presetKeys = useMemo(
    () => (SPEC_PRESETS[kind] ?? []).filter((k) => !specs.some((s) => s.key === k)),
    [kind, specs],
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = item ? await updateItem(item.id, fd) : await createItem(fd);
      if (!res.ok) {
        setError(res.error);
        setErrors(res.fieldErrors ?? {});
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const id = res.id!;
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        try {
          await uploadFile(id, f, (pct) => setProgress(`Đang tải ${i + 1}/${files.length}: ${f.name} (${pct}%)`));
        } catch (err) {
          failed.push(`${f.name}: ${(err as Error).message}`);
        }
      }
      setProgress(null);
      if (failed.length) alert(`Một số file chưa tải lên được:\n${failed.join("\n")}`);
      router.push(`/items/${id}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      <Section title="Thông tin cơ bản">
        <Field label="Tên mặt hàng *" error={errors.name} className="sm:col-span-2">
          <input
            name="name"
            defaultValue={item?.name}
            required
            autoFocus={!item}
            className="input"
            placeholder="VD: Điện trở 10kΩ 1/4W, ESP32-WROOM-32, Mỏ hàn T12…"
          />
        </Field>
        <Field label="Loại">
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as ItemKind)} className="input">
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Danh mục">
          <select name="categoryId" defaultValue={item?.categoryId ?? ""} className="input">
            <option value="">— Chưa phân loại —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mã riêng (SKU)" error={errors.sku} hint="Mã bạn tự đặt, dán trên hộp. Không trùng nhau.">
          <input
            name="sku"
            defaultValue={item?.sku ?? ""}
            className="input font-mono"
            placeholder="R-10K-0805"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Tags" hint="Phân cách bằng dấu phẩy">
          <input
            name="tags"
            defaultValue={item?.tags.join(", ")}
            className="input"
            placeholder="smd, arduino, nguồn…"
            list="tag-suggestions"
          />
          <datalist id="tag-suggestions">
            {suggestions.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Mô tả" className="sm:col-span-2">
          <textarea name="description" defaultValue={item?.description ?? ""} rows={3} className="input" />
        </Field>
      </Section>

      <Section title="Thông số kỹ thuật">
        <Field label="Hãng sản xuất">
          <input name="manufacturer" defaultValue={item?.manufacturer ?? ""} className="input" list="mfr-list" />
          <datalist id="mfr-list">
            {suggestions.manufacturers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Mã nhà sản xuất (MPN)">
          <input
            name="mpn"
            defaultValue={item?.mpn ?? ""}
            className="input font-mono"
            placeholder="NE555P"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Package / Kiểu chân">
          <input
            name="package"
            defaultValue={item?.package ?? ""}
            className="input"
            placeholder="DIP-8, SOT-23, 0805…"
            list="pkg-list"
          />
          <datalist id="pkg-list">
            {[...new Set([...suggestions.packages, "DIP-8", "DIP-16", "SOP-8", "SOT-23", "TO-92", "TO-220", "0402", "0603", "0805", "1206", "QFN", "LQFP-48"])].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Link datasheet" error={errors.datasheetUrl}>
          <input
            name="datasheetUrl"
            defaultValue={item?.datasheetUrl ?? ""}
            className="input"
            placeholder="https://…"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </Field>

        <div className="sm:col-span-2">
          <span className="label">Thông số khác</span>
          <div className="space-y-2">
            {specs.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input
                  name="specKey"
                  value={s.key}
                  onChange={(e) => setSpecs((arr) => arr.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  className="input w-2/5 min-w-0"
                  placeholder="Tên thông số"
                />
                <input
                  name="specValue"
                  value={s.value}
                  onChange={(e) => setSpecs((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  className="input min-w-0 flex-1"
                  placeholder="Giá trị"
                />
                <button
                  type="button"
                  onClick={() => setSpecs((arr) => arr.filter((_, j) => j !== i))}
                  className="btn-ghost shrink-0 px-2 pointer-coarse:min-w-10"
                  aria-label="Xoá dòng"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSpecs((a) => [...a, { key: "", value: "" }])} className="btn-secondary btn-sm">
              <Plus className="size-3.5" /> Thêm dòng
            </button>
            {presetKeys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setSpecs((a) => {
                    const emptyIdx = a.findIndex((x) => !x.key && !x.value);
                    if (emptyIdx >= 0) return a.map((x, j) => (j === emptyIdx ? { key: k, value: "" } : x));
                    return [...a, { key: k, value: "" }];
                  })
                }
                className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent-strong pointer-coarse:min-h-9 pointer-coarse:px-3"
              >
                + {k}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Tồn kho">
        <Field
          label="Số lượng hiện có"
          error={errors.quantity}
          hint={item ? "Thay đổi ở đây sẽ được ghi là một lần kiểm kê" : undefined}
        >
          <input
            name="quantity"
            defaultValue={item?.quantity ?? 0}
            inputMode="decimal"
            className="input tabular-nums"
          />
        </Field>
        <Field label="Đơn vị">
          <input name="unit" defaultValue={item?.unit ?? "cái"} className="input" list="unit-list" />
          <datalist id="unit-list">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Mức tối thiểu" error={errors.minQuantity} hint="Thấp hơn mức này sẽ báo “cần mua thêm”. 0 = không theo dõi.">
          <input name="minQuantity" defaultValue={item?.minQuantity ?? 0} inputMode="decimal" className="input tabular-nums" />
        </Field>
        <Field label="Vị trí cất">
          <select name="locationId" defaultValue={item?.locationId ?? ""} className="input">
            <option value="">— Chưa chọn —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Mua hàng">
        <Field label="Đơn giá (₫)" error={errors.unitPrice}>
          <input name="unitPrice" defaultValue={item?.unitPrice ?? ""} inputMode="decimal" className="input tabular-nums" placeholder="VD: 500" />
        </Field>
        <Field label="Nhà cung cấp">
          <input
            name="supplier"
            defaultValue={item?.supplier ?? ""}
            className="input"
            list="supplier-list"
            placeholder="banlinhkien, Hshop, Shopee…"
          />
          <datalist id="supplier-list">
            {[...new Set([...suggestions.suppliers, "Ban Linh Kiện", "Hshop", "Điện Tử Tương Lai", "Shopee", "LCSC", "AliExpress"])].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Link mua hàng" error={errors.purchaseUrl} className="sm:col-span-2">
          <input
            name="purchaseUrl"
            defaultValue={item?.purchaseUrl ?? ""}
            className="input"
            placeholder="https://…"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <textarea name="notes" defaultValue={item?.notes ?? ""} rows={2} className="input" />
        </Field>
      </Section>

      {!item && (
        <Section title="Ảnh / video / tài liệu">
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-center text-sm text-muted transition hover:border-accent hover:text-accent-strong">
              <ImagePlus className="size-8" />
              <span>Chụp / chọn ảnh, video hoặc datasheet PDF (có thể chọn nhiều)</span>
              <input
                type="file"
                multiple
                accept={ACCEPT_MEDIA}
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  setFiles((f) => [...f, ...list]);
                  e.target.value = "";
                }}
              />
            </label>
            {files.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-surface-2 py-1 pr-1 pl-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted">{fmtBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((a) => a.filter((_, j) => j !== i))}
                      className="grid size-9 shrink-0 place-items-center text-muted hover:text-danger"
                      aria-label={`Bỏ ${f.name}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

      <div className="sticky bottom-(--tabbar) z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        {progress && <span className="w-full truncate text-xs text-muted sm:mr-auto sm:w-auto">{progress}</span>}
        <button type="button" onClick={() => router.back()} className="btn-secondary" disabled={pending}>
          Huỷ
        </button>
        <button type="submit" className="btn-primary max-sm:flex-1" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {item ? "Lưu thay đổi" : "Thêm vào kho"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="card p-4 sm:p-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  error,
  hint,
  className = "",
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
