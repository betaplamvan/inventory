"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Camera, ChevronLeft, ChevronRight, Download, FileText, Play, Star, Trash2, Upload, X } from "lucide-react";
import { deleteMedia, setCover } from "@/actions/items";
import type { Media } from "@/db/schema";
import { fmtBytes } from "@/lib/format";
import { ACCEPT_MEDIA, uploadFile } from "@/lib/upload-client";

type M = Pick<Media, "id" | "kind" | "filename" | "size" | "thumbKey" | "contentType">;

const url = (m: M, thumb = false) => `/api/media/${m.id}${thumb && m.thumbKey ? "?thumb=1" : ""}`;

export function MediaGallery({ itemId, media, coverId }: { itemId: number; media: M[]; coverId: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [uploads, setUploads] = useState<{ name: string; pct: number; error?: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [, start] = useTransition();

  const visual = media.filter((m) => m.kind !== "file");
  const files = media.filter((m) => m.kind === "file");

  const upload = useCallback(
    async (list: File[]) => {
      if (!list.length) return;
      setUploads(list.map((f) => ({ name: f.name, pct: 0 })));
      for (const [i, f] of list.entries()) {
        try {
          await uploadFile(itemId, f, (pct) =>
            setUploads((u) => u.map((x, j) => (j === i ? { ...x, pct } : x))),
          );
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, pct: 100 } : x)));
        } catch (err) {
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, error: (err as Error).message } : x)));
        }
      }
      router.refresh();
      setUploads((u) => u.filter((x) => x.error));
    },
    [itemId, router],
  );

  const remove = (m: M) => {
    if (!confirm(`Xoá "${m.filename}"?`)) return;
    start(async () => {
      await deleteMedia(m.id);
      setOpen(null);
    });
  };

  return (
    <div className="space-y-3">
      {visual.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {visual.map((m, i) => (
            <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2">
              <button type="button" onClick={() => setOpen(i)} className="size-full">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url(m, true)} alt={m.filename} loading="lazy" className="size-full object-cover" />
                ) : (
                  <div className="relative size-full">
                    <video src={`${url(m)}#t=0.5`} preload="metadata" muted className="size-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-black/20">
                      <Play className="size-8 fill-white text-white" />
                    </span>
                  </div>
                )}
              </button>
              {m.id === coverId && (
                <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Ảnh đại diện
                </span>
              )}
              <div className="absolute top-1.5 right-1.5 flex gap-1 transition group-hover:opacity-100 focus-within:opacity-100 can-hover:opacity-0">
                {m.kind === "image" && m.id !== coverId && (
                  <IconBtn title="Đặt làm ảnh đại diện" onClick={() => start(() => setCover(itemId, m.id))}>
                    <Star className="size-3.5" />
                  </IconBtn>
                )}
                <IconBtn title="Xoá" onClick={() => remove(m)}>
                  <Trash2 className="size-3.5" />
                </IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg bg-surface-2 py-1 pr-1 pl-3 text-sm">
              <FileText className="size-4 shrink-0 text-muted" />
              <a href={url(m)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate py-1.5 hover:underline">
                {m.filename}
              </a>
              <span className="shrink-0 text-xs text-muted">{fmtBytes(m.size)}</span>
              <a
                href={`/api/media/${m.id}?download=1`}
                className="grid size-9 shrink-0 place-items-center text-muted hover:text-foreground"
                title="Tải về"
                aria-label="Tải về"
              >
                <Download className="size-4" />
              </a>
              <button
                type="button"
                onClick={() => remove(m)}
                className="grid size-9 shrink-0 place-items-center text-muted hover:text-danger"
                title="Xoá"
                aria-label="Xoá"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Điện thoại: nút chụp thẳng bằng camera sau (không qua thư viện ảnh) */}
      <label className="btn-secondary w-full cursor-pointer can-hover:hidden">
        <Camera className="size-4" /> Chụp ảnh
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(Array.from(e.dataTransfer.files));
        }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-sm transition ${
          dragging ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:border-accent hover:text-accent-strong"
        }`}
      >
        <Upload className="size-4 shrink-0" />
        <span className="can-hover:hidden">Chọn ảnh, video, tài liệu PDF</span>
        <span className="hidden can-hover:inline">Thêm ảnh / video / tài liệu PDF (kéo thả hoặc bấm để chọn)</span>
        <input
          type="file"
          multiple
          accept={ACCEPT_MEDIA}
          className="hidden"
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>

      {uploads.length > 0 && (
        <ul className="space-y-1.5">
          {uploads.map((u, i) => (
            <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate">{u.name}</span>
                <span className={u.error ? "text-danger" : "text-muted"}>{u.error ?? `${u.pct}%`}</span>
              </div>
              {!u.error && (
                <div className="mt-1.5 h-1 rounded-full bg-border">
                  <div className="h-1 rounded-full bg-accent transition-all" style={{ width: `${u.pct}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open != null && visual[open] && (
        <Lightbox
          items={visual}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80 pointer-coarse:size-9"
    >
      {children}
    </button>
  );
}

function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: M[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const m = items[index];
  const prev = useCallback(() => onIndex((index - 1 + items.length) % items.length), [index, items.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % items.length), [index, items.length, onIndex]);
  // Vuốt ngang để chuyển ảnh (bỏ qua khi đang zoom 2 ngón, và video vì có thanh tua)
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches.length === 1 ? e.touches[0] : null;
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s || items.length < 2 || m.kind !== "image") return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, prev, next]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div
        className="flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-sm text-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">
          {index + 1}/{items.length} · {m.filename} · {fmtBytes(m.size)}
        </span>
        <div className="flex shrink-0 gap-1">
          <a href={`/api/media/${m.id}?download=1`} className="rounded-md p-2 hover:bg-white/10" title="Tải về">
            <Download className="size-5" />
          </a>
          <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-white/10" title="Đóng">
            <X className="size-5" />
          </button>
        </div>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {m.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url(m)} alt={m.filename} className="max-h-full max-w-full object-contain" />
        ) : (
          <video key={m.id} src={url(m)} controls autoPlay className="max-h-full max-w-full" />
        )}
        {items.length > 1 && (
          <>
            <button type="button" onClick={prev} className="absolute left-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Trước">
              <ChevronLeft className="size-6" />
            </button>
            <button type="button" onClick={next} className="absolute right-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Sau">
              <ChevronRight className="size-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
