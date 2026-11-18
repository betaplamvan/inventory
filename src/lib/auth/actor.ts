import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { requireUser } from "./session";

/**
 * "Actor" = người đang thao tác dữ liệu. Trên web là user của cookie phiên;
 * với agent/MCP là chủ của API token — đặt bằng runAsUser() quanh lời gọi tool.
 * Mọi truy vấn kho đều lọc theo currentUserId().
 */
const store = new AsyncLocalStorage<{ userId: string }>();

export function runAsUser<T>(userId: string, fn: () => Promise<T>) {
  return store.run({ userId }, fn);
}

export async function currentUserId() {
  const actor = store.getStore();
  if (actor) return actor.userId;
  return (await requireUser()).id;
}
