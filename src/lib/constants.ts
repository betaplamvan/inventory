import type { ItemKind, MovementSource, MovementType } from "@/db/schema";

export const KIND_LABELS: Record<ItemKind, string> = {
  component: "Linh kiện",
  module: "Module / Board",
  tool: "Dụng cụ",
  consumable: "Vật tư tiêu hao",
  equipment: "Thiết bị đo",
  other: "Khác",
};

export const KIND_COLORS: Record<ItemKind, string> = {
  component: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  module: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  tool: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  consumable: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  equipment: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  other: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export const ITEM_KINDS = Object.keys(KIND_LABELS) as ItemKind[];

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: "Nhập",
  out: "Xuất",
  adjust: "Kiểm kê",
};

const SOURCE_LABELS: Record<MovementSource, string> = { web: "Web", agent: "Agent", import: "Nhập file" };

/** "Web", "Agent · Claude web", "Nhập file"; null = dữ liệu cũ (trước khi có ghi nguồn) */
export function sourceLabel(m: { source: MovementSource | null; sourceName: string | null }) {
  if (!m.source) return null;
  const base = SOURCE_LABELS[m.source] ?? m.source;
  return m.sourceName ? `${base} · ${m.sourceName}` : base;
}

export const UNITS = ["cái", "con", "bộ", "chiếc", "cuộn", "mét", "gram", "hộp", "túi", "tấm", "lọ", "cặp"];

export const PAGE_SIZE = 24;
