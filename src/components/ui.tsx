import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Cpu, Film, FileText, RefreshCw } from "lucide-react";
import type { ItemKind, Media } from "@/db/schema";
import { KIND_COLORS, KIND_LABELS } from "@/lib/constants";
import { fmtQty } from "@/lib/format";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <div className="mb-1">{back}</div>}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KindBadge({ kind }: { kind: ItemKind }) {
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium ${KIND_COLORS[kind]}`}>
      {KIND_LABELS[kind]}
    </span>
  );
}

export function stockState(quantity: number, minQuantity: number) {
  if (quantity <= 0) return "out" as const;
  if (minQuantity > 0 && quantity <= minQuantity) return "low" as const;
  return "ok" as const;
}

export function StockQty({
  quantity,
  minQuantity,
  unit,
  size = "md",
}: {
  quantity: number;
  minQuantity: number;
  unit: string;
  size?: "md" | "lg";
}) {
  const state = stockState(quantity, minQuantity);
  const color = state === "out" ? "text-danger" : state === "low" ? "text-warning" : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`font-semibold tabular-nums ${color} ${size === "lg" ? "text-3xl" : "text-base"}`}>
        {fmtQty(quantity)}
      </span>
      <span className="text-xs text-muted">{unit}</span>
    </span>
  );
}

export function StockStateBadge({ quantity, minQuantity }: { quantity: number; minQuantity: number }) {
  const state = stockState(quantity, minQuantity);
  if (state === "ok") return null;
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        state === "out" ? "bg-danger/12 text-danger" : "bg-warning/15 text-warning"
      }`}
    >
      {state === "out" ? "Hết hàng" : "Sắp hết"}
    </span>
  );
}

export function mediaUrl(m: Pick<Media, "id">, opts: { thumb?: boolean; download?: boolean } = {}) {
  const q = opts.thumb ? "?thumb=1" : opts.download ? "?download=1" : "";
  return `/api/media/${m.id}${q}`;
}

export function ItemThumb({
  cover,
  className = "size-12",
  iconClass = "size-5",
}: {
  cover?: Pick<Media, "id" | "kind" | "thumbKey"> | null;
  className?: string;
  iconClass?: string;
}) {
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 ${className}`}>
      {cover?.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh phục vụ qua API riêng
        <img
          src={mediaUrl(cover, { thumb: !!cover.thumbKey })}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : cover?.kind === "video" ? (
        <Film className={`${iconClass} text-muted`} />
      ) : cover ? (
        <FileText className={`${iconClass} text-muted`} />
      ) : (
        <Cpu className={`${iconClass} text-muted/60`} />
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-muted/60">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (p: number) => string;
}) {
  if (pageCount <= 1) return null;
  const pages: (number | "…")[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  return (
    <nav className="mt-6 flex flex-wrap items-center justify-center gap-1">
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-2 text-muted">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            className={`min-w-9 rounded-lg px-3 py-1.5 text-center text-sm ${
              p === page ? "bg-accent text-white dark:text-black" : "text-muted hover:bg-surface-2"
            }`}
          >
            {p}
          </Link>
        ),
      )}
    </nav>
  );
}

/** Tạo query string từ object, bỏ qua giá trị rỗng */
export function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function MovementIcon({ type }: { type: "in" | "out" | "adjust" }) {
  const map = {
    in: { Icon: ArrowDownLeft, cls: "bg-accent-soft text-accent-strong", label: "Nhập" },
    out: { Icon: ArrowUpRight, cls: "bg-danger/10 text-danger", label: "Xuất" },
    adjust: { Icon: RefreshCw, cls: "bg-surface-2 text-muted", label: "Kiểm kê" },
  } as const;
  const { Icon, cls, label } = map[type];
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${cls}`} title={label}>
      <Icon className="size-4" />
    </span>
  );
}
