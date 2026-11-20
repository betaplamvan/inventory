"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { importCsv, type ImportState } from "@/actions/import";
import type { ImportRowResult } from "@/lib/inventory/import";
import { fmtQty } from "@/lib/format";

const ACTION_LABEL: Record<ImportRowResult["action"], { label: string; cls: string }> = {
  create: { label: "Thêm mới", cls: "bg-accent-soft text-accent-strong" },
  update: { label: "Cập nhật", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  skip: { label: "Bỏ qua", cls: "bg-surface-2 text-muted" },
  error: { label: "Lỗi", cls: "bg-danger/12 text-danger" },
};

/** Đọc file: thử UTF-8 trước; nếu có ký tự lỗi (file CSV lưu bằng Excel cũ, mã Windows-1258/1252) thì đọc lại. */
async function readText(file: File) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  for (const enc of ["windows-1258", "windows-1252"]) {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {}
  }
  return utf8;
}

export function ImportForm() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [onExisting, setOnExisting] = useState<"update" | "skip">("update");
  const [createMissing, setCreateMissing] = useState(true);
  const [state, setState] = useState<ImportState | null>(null);
  const [pending, start] = useTransition();
  const [committing, setCommitting] = useState(false);

  const run = (commit: boolean) => {
    setCommitting(commit);
    start(async () => setState(await importCsv(text, { onExisting, createMissing, commit })));
  };

  // Đổi dữ liệu hoặc tuỳ chọn thì bản xem trước cũ không còn đúng
  const reset = () => setState(null);

  const preview = state?.ok && !state.done ? state.result : null;
  const done = state?.ok && state.done ? state.result : null;
  const result = state?.ok ? state.result : null;
  const writable = preview ? preview.created + preview.updated : 0;

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-5 text-sm text-muted transition hover:border-accent hover:text-accent">
          <FileUp className="size-4 shrink-0" />
          <span className="truncate">{fileName ?? "Chọn file .csv / .tsv / .txt"}</span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setFileName(f.name);
              setText(await readText(f));
              reset();
            }}
          />
        </label>
        <div>
          <label className="label" htmlFor="import-text">
            …hoặc dán bảng (chọn các ô trong Excel / Google Sheets, kể cả dòng tiêu đề, rồi dán vào đây)
          </label>
          <textarea
            id="import-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
              reset();
            }}
            rows={8}
            spellCheck={false}
            className="input font-mono text-xs pointer-coarse:text-sm"
            placeholder={"Tên,SKU,Số lượng,Vị trí\nTụ gốm 100nF 0805,C-100N,200,Tủ A > Ngăn 1"}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Dòng trùng ID / SKU với mặt hàng đang có</label>
            <select
              className="input"
              value={onExisting}
              onChange={(e) => {
                setOnExisting(e.target.value as "update" | "skip");
                reset();
              }}
            >
              <option value="update">Cập nhật mặt hàng đó</option>
              <option value="skip">Bỏ qua, giữ nguyên</option>
            </select>
          </div>
          <label className="flex items-center gap-2 self-end py-2 text-sm">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(e) => {
                setCreateMissing(e.target.checked);
                reset();
              }}
              className="size-4 accent-[var(--accent)]"
            />
            Tự tạo danh mục / vị trí chưa có
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={!text.trim() || pending} onClick={() => run(false)}>
            {pending && !committing && <Loader2 className="size-4 animate-spin" />} Xem trước
          </button>
          {preview && (
            <button type="button" className="btn-primary" disabled={!writable || pending} onClick={() => run(true)}>
              {pending && committing && <Loader2 className="size-4 animate-spin" />}
              Nhập {writable} dòng
            </button>
          )}
        </div>
      </div>

      {state && !state.ok && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{state.error}</div>
      )}

      {state?.columns && state.columns.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-muted">Cột:</span>
          {state.columns.map((c, i) => (
            <span
              key={i}
              className={`rounded px-1.5 py-0.5 ${c.field ? "bg-surface-2" : "bg-warning/15 text-warning line-through"}`}
              title={c.field ? `→ ${c.field}` : "Không nhận ra cột này — bỏ qua"}
            >
              {c.header || "(trống)"}
            </span>
          ))}
        </div>
      )}

      {done && (
        <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-strong">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>
            Đã thêm {done.created}, cập nhật {done.updated}
            {done.skipped > 0 && `, bỏ qua ${done.skipped}`}
            {done.failed > 0 && `, lỗi ${done.failed}`} mặt hàng.{" "}
            <Link href="/items?sort=updated" className="underline">
              Xem trong kho
            </Link>
          </p>
        </div>
      )}

      {result && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-sm">
            <span className="font-medium">{done ? "Kết quả" : "Xem trước — chưa ghi gì"}</span>
            <span className="text-accent-strong">{result.created} thêm mới</span>
            <span className="text-sky-700 dark:text-sky-300">{result.updated} cập nhật</span>
            {result.skipped > 0 && <span className="text-muted">{result.skipped} bỏ qua</span>}
            {result.failed > 0 && <span className="text-danger">{result.failed} lỗi (không nhập)</span>}
          </div>
          <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto text-sm">
            {result.rows.map((r) => {
              const a = ACTION_LABEL[r.action];
              return (
                <li key={r.line} className="flex gap-3 px-4 py-2">
                  <span className="w-10 shrink-0 pt-0.5 text-right text-xs text-muted tabular-nums">#{r.line}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${a.cls}`}>{a.label}</span>
                      {r.id && done ? (
                        <Link href={`/items/${r.id}`} className="font-medium hover:underline">
                          {r.name || "(không tên)"}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.name || "(không tên)"}</span>
                      )}
                      {r.sku && <span className="font-mono text-xs text-muted">{r.sku}</span>}
                      {r.quantity != null && <span className="text-xs text-muted tabular-nums">SL {fmtQty(r.quantity)}</span>}
                    </p>
                    {r.messages.length > 0 && (
                      <p className={`mt-0.5 text-xs ${r.action === "error" ? "text-danger" : "text-muted"}`}>
                        {r.messages.join(" · ")}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
