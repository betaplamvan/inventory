import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { MovementSource } from "@/db/schema";
import { requireUser } from "./session";

/** Thao tác đến từ đâu — ghi kèm vào lịch sử nhập/xuất và thùng rác. */
export type Via = { source: MovementSource; name?: string | null };

/**
 * "Actor" = người đang thao tác dữ liệu. Trên web là user của cookie phiên;
 * với agent/MCP là chủ của API token — đặt bằng runAsUser() quanh lời gọi tool.
 * Mọi truy vấn kho đều lọc theo currentUserId().
 */
const store = new AsyncLocalStorage<{ userId: string; via: Via }>();

export function runAsUser<T>(userId: string, fn: () => Promise<T>, via: Via = { source: "agent" }) {
  return store.run({ userId, via }, fn);
}

export async function currentUserId() {
  const actor = store.getStore();
  if (actor) return actor.userId;
  return (await requireUser()).id;
}

/** Nguồn của thao tác hiện tại: mặc định là giao diện web, trừ khi đang chạy trong runAsUser(). */
export function currentVia(): Via {
  return store.getStore()?.via ?? { source: "web" };
}

/** Nhãn ngắn để lưu / hiển thị: "web", "agent: Claude web", "import" */
export function viaLabel(via: Via = currentVia()) {
  return via.name ? `${via.source}: ${via.name}` : via.source;
}
