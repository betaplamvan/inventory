"use client";

import { useSyncExternalStore } from "react";
import { applyEvent, awaitingCalls, tempMessageId, updateCall, type ChatView } from "@/lib/chat/reducer";
import type { ChatDecision, ChatStreamEvent, UiMessage, UiToolCall } from "@/lib/chat/types";

/**
 * Trạng thái chat phía trình duyệt, sống suốt phiên (module, không gắn với component):
 * khung chat nổi và trang /chat cùng đọc từ đây, nên chuyển trang / đóng khung chat không làm mất
 * câu trả lời đang chạy. Kết nối stream cũng do store giữ, component unmount không huỷ nó.
 * Mất kết nối (điện thoại khoá màn hình, mạng chập chờn) → tự nối lại vào lượt đang chạy trên server.
 *
 * Khoá: id cuộc trò chuyện, hoặc khoá nháp "new:…" cho cuộc chưa gửi tin nào
 * (đổi thành id thật khi server tạo cuộc trò chuyện).
 */

export type ConvState = ChatView & {
  status: "idle" | "loading" | "streaming";
  loaded: boolean;
  /** Quyết định cho các thao tác ghi đang chờ (gửi khi đã quyết hết) */
  decisions: Record<string, ChatDecision>;
};

const EMPTY: ConvState = { messages: [], thinking: false, error: null, status: "idle", loaded: false, decisions: {} };

const states = new Map<string, ConvState>();
const aliases = new Map<string, string>();
/** Kết nối stream đang mở theo id thật / khoá nháp */
const readers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

let draftCounter = 0;
export const newDraftKey = () => `new:${++draftCounter}`;
export const isDraft = (key: string) => key.startsWith("new:");
const resolve = (key: string) => aliases.get(key) ?? key;

function get(key: string) {
  return states.get(resolve(key)) ?? EMPTY;
}

function update(key: string, fn: (s: ConvState) => ConvState) {
  const k = resolve(key);
  states.set(k, fn(states.get(k) ?? EMPTY));
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChatState(key: string): ConvState {
  return useSyncExternalStore(
    subscribe,
    () => get(key),
    () => EMPTY,
  );
}

/** Báo cho danh sách cuộc trò chuyện (trang /chat) cập nhật */
const notifyActivity = () => window.dispatchEvent(new Event("kho:chat-activity"));

/* ---------------- Cuộc trò chuyện gần nhất (khung nổi mở lại đúng cuộc đó) ---------------- */

/** Mỗi kho nhớ cuộc trò chuyện gần nhất riêng */
const lastKey = (domain: string) => `inv-chat-last:${domain}`;
export function readLast(domain: string) {
  try {
    return localStorage.getItem(lastKey(domain));
  } catch {
    return null;
  }
}
export function writeLast(domain: string, id: string | null) {
  try {
    if (id) localStorage.setItem(lastKey(domain), id);
    else localStorage.removeItem(lastKey(domain));
  } catch {}
}

/* ---------------- Đọc stream ---------------- */

type Created = (id: string, title: string) => void;

/** Đọc SSE của một lượt chạy và áp vào state. Trả về true nếu thấy sự kiện "done" (lượt đã kết thúc). */
async function consume(key: string, res: Response, signal: AbortSignal, onCreated?: Created) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;
  let curKey = key;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const line = buf
          .slice(0, sep)
          .split("\n")
          .find((l) => l.startsWith("data:"));
        buf = buf.slice(sep + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(5)) as ChatStreamEvent;
        if (ev.type === "conversation" && isDraft(curKey)) {
          // Cuộc mới: chuyển state từ khoá nháp sang id thật
          states.set(ev.id, get(curKey));
          states.delete(curKey);
          aliases.set(curKey, ev.id);
          const ctrl = readers.get(curKey);
          readers.delete(curKey);
          if (ctrl) readers.set(ev.id, ctrl);
          curKey = ev.id;
          onCreated?.(ev.id, ev.title);
          notifyActivity();
        }
        if (ev.type === "done") finished = true;
        update(curKey, (s) => applyEvent(s, ev));
      }
    }
  } catch (err) {
    if (!signal.aborted) throw err;
  }
  return { finished, key: curKey };
}

/** Theo dõi 1 stream (POST gửi tin / GET nối lại) cho tới khi xong; mất kết nối → tự nối lại */
async function follow(key: string, open: (signal: AbortSignal) => Promise<Response>, onCreated?: Created) {
  const ctrl = new AbortController();
  readers.set(resolve(key), ctrl);
  update(key, (s) => ({ ...s, status: "streaming", error: null, loaded: true }));
  let id = resolve(key);
  let finished = false;
  let lostConnection = false;
  let busy = false;
  try {
    const res = await open(ctrl.signal);
    if (res.status === 204) return; // không còn lượt nào chạy
    if (res.status === 409) {
      // Đang trả lời (gửi từ tab / thiết bị khác) → nối vào lượt đó
      busy = true;
      update(key, (s) => ({ ...s, error: "Trợ lý đang trả lời cuộc trò chuyện này — chờ xong rồi gửi lại." }));
      return;
    }
    if (!res.ok || !res.body) {
      const msg = (await res.json().catch(() => null))?.error ?? `Lỗi ${res.status}`;
      update(key, (s) => ({ ...s, error: msg }));
      return;
    }
    ({ finished, key: id } = await consume(key, res, ctrl.signal, onCreated));
    lostConnection = !finished && !ctrl.signal.aborted;
  } catch (err) {
    if (!ctrl.signal.aborted) {
      lostConnection = true;
      console.warn("[chat] mất kết nối stream:", (err as Error).message);
    }
  } finally {
    if (readers.get(id) === ctrl) readers.delete(id);
    update(id, (s) => ({ ...s, status: s.status === "streaming" ? "idle" : s.status, thinking: false }));
    notifyActivity();
  }
  // Lượt chạy trên server vẫn tiếp tục → nối lại sau giây lát
  if (lostConnection && !isDraft(id)) setTimeout(() => void resync(id), 1500);
  if (busy && !isDraft(id)) void resync(id, { keepError: true });
}

/* ---------------- Hành động ---------------- */

/** Tải lịch sử; nếu đang có lượt chạy nền thì nối vào để xem tiếp */
async function resync(id: string, opts: { keepError?: boolean } = {}): Promise<"ok" | "notfound"> {
  if (readers.has(id)) return "ok";
  const res = await fetch(`/api/chat/conversations/${id}`).catch(() => null);
  if (!res) {
    update(id, (s) => ({ ...s, status: "idle", error: "Mất kết nối, thử lại sau" }));
    return "ok";
  }
  if (res.status === 404) {
    update(id, () => EMPTY);
    return "notfound";
  }
  if (!res.ok) {
    update(id, (s) => ({ ...s, status: "idle", error: "Không tải được cuộc trò chuyện" }));
    return "ok";
  }
  const data = (await res.json()) as { messages: UiMessage[]; running: boolean };
  if (readers.has(id)) return "ok"; // trong lúc tải đã có stream khác
  update(id, (s) => ({
    ...s,
    messages: data.messages,
    status: "idle",
    loaded: true,
    error: opts.keepError ? s.error : null,
    decisions: {},
  }));
  if (data.running) {
    void follow(id, (signal) => fetch(`/api/chat/conversations/${id}/stream`, { signal }));
  }
  return "ok";
}

/** Mở cuộc trò chuyện để hiển thị (gọi khi panel mount). Đang stream thì giữ nguyên. */
export async function openConversation(key: string): Promise<"ok" | "notfound"> {
  if (isDraft(key) && !aliases.has(key)) return "ok";
  const id = resolve(key);
  const s = states.get(id);
  if (s?.status === "streaming" || readers.has(id)) return "ok";
  if (!s?.loaded) update(id, (x) => ({ ...x, status: "loading" }));
  return resync(id);
}

export function sendMessage(key: string, text: string, onCreated?: Created) {
  const t = text.trim();
  if (!t || get(key).status === "streaming") return;
  // Gửi tin mới khi còn thao tác chờ xác nhận → server tự bỏ qua các thao tác đó
  update(key, (s) => ({
    ...s,
    decisions: {},
    messages: [
      ...awaitingCalls(s.messages).reduce(
        (acc, c) => updateCall(acc, c.id, { status: "rejected", result: "Đã bỏ qua" }),
        s.messages,
      ),
      { id: tempMessageId(), role: "user", parts: [{ type: "text", text: t }] },
    ],
  }));
  const conversationId = isDraft(resolve(key)) ? null : resolve(key);
  void follow(
    key,
    (signal) =>
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: t }),
        signal,
      }),
    onCreated,
  );
}

export function decide(key: string, call: UiToolCall, decision: ChatDecision) {
  const s = get(key);
  if (s.status === "streaming" || isDraft(resolve(key))) return;
  const next = { ...s.decisions, [call.id]: decision };
  const pending = awaitingCalls(s.messages);
  const ready = pending.every((c) => next[c.id]);
  update(key, (x) => ({
    ...x,
    decisions: ready ? {} : next,
    messages: updateCall(x.messages, call.id, { status: decision === "approve" ? "running" : "rejected" }),
  }));
  if (!ready) return;
  const id = resolve(key);
  void follow(id, (signal) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id, decisions: next }),
      signal,
    }),
  );
}

/** Xác nhận / bỏ qua tất cả thao tác đang chờ trong một lần */
export function decideAll(key: string, decision: ChatDecision) {
  const s = get(key);
  if (s.status === "streaming" || isDraft(resolve(key))) return;
  const pending = awaitingCalls(s.messages);
  if (!pending.length) return;
  const all = { ...s.decisions, ...Object.fromEntries(pending.map((c) => [c.id, decision])) };
  update(key, (x) => ({
    ...x,
    decisions: {},
    messages: pending.reduce(
      (acc, c) => updateCall(acc, c.id, { status: decision === "approve" ? "running" : "rejected" }),
      x.messages,
    ),
  }));
  const id = resolve(key);
  void follow(id, (signal) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id, decisions: all }),
      signal,
    }),
  );
}

/** Nút Dừng: dừng lượt chạy trên server (stream sẽ tự kết thúc) */
export function stop(key: string) {
  const id = resolve(key);
  if (isDraft(id)) {
    readers.get(id)?.abort();
    return;
  }
  void fetch("/api/chat/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: id }),
  }).catch(() => readers.get(id)?.abort());
}

/** Xoá cuộc trò chuyện khỏi store (sau khi xoá trên server) */
export function forget(id: string) {
  readers.get(id)?.abort();
  readers.delete(id);
  states.delete(id);
  for (const l of listeners) l();
}
