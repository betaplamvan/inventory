/**
 * Áp sự kiện stream (ChatStreamEvent) vào danh sách tin nhắn hiển thị — hàm thuần, dùng chung khi
 * gửi tin nhắn lẫn khi nối lại vào lượt đang chạy (snapshot + phát lại sự kiện).
 */
import type { ChatStreamEvent, UiMessage, UiPart, UiToolCall } from "./types";

export type ChatView = { messages: UiMessage[]; thinking: boolean; error: string | null };

let tempId = 0;
export const tempMessageId = () => `tmp-${++tempId}`;

function withAssistant(msgs: UiMessage[], fn: (parts: UiPart[]) => UiPart[]): UiMessage[] {
  const last = msgs.at(-1);
  if (last?.role === "assistant") return [...msgs.slice(0, -1), { ...last, parts: fn(last.parts) }];
  return [...msgs, { id: tempMessageId(), role: "assistant", parts: fn([]) }];
}

function appendText(parts: UiPart[], delta: string): UiPart[] {
  const last = parts.at(-1);
  if (last?.type === "text") return [...parts.slice(0, -1), { type: "text", text: last.text + delta }];
  return [...parts, { type: "text", text: delta }];
}

const hasCall = (msgs: UiMessage[], id: string) =>
  msgs.some((m) => m.parts.some((p) => p.type === "tool" && p.call.id === id));

export function updateCall(msgs: UiMessage[], id: string, patch: Partial<UiToolCall>): UiMessage[] {
  return msgs.map((m) =>
    m.parts.some((p) => p.type === "tool" && p.call.id === id)
      ? {
          ...m,
          parts: m.parts.map((p) =>
            p.type === "tool" && p.call.id === id ? { ...p, call: { ...p.call, ...patch } } : p,
          ),
        }
      : m,
  );
}

export const awaitingCalls = (msgs: UiMessage[]) =>
  msgs.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool" && p.call.status === "awaiting" ? [p.call] : [])));

export function applyEvent<T extends ChatView>(s: T, ev: ChatStreamEvent): T {
  switch (ev.type) {
    case "snapshot":
      return { ...s, messages: ev.messages, thinking: false, error: null };
    case "user": {
      // Tin vừa gửi (id tạm, hiện ngay khi bấm gửi) → thay bằng id thật; nối lại từ nơi khác → thêm mới
      const i = s.messages.findLastIndex((m) => m.role === "user");
      const mine = s.messages[i];
      const sameText =
        mine?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ===
        ev.message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
      if (mine?.id.startsWith("tmp-") && sameText) {
        return { ...s, messages: s.messages.map((m, j) => (j === i ? { ...m, id: ev.message.id } : m)) };
      }
      return { ...s, messages: [...s.messages, ev.message] };
    }
    case "thinking":
      return { ...s, thinking: true };
    case "text":
      return { ...s, thinking: false, messages: withAssistant(s.messages, (p) => appendText(p, ev.delta)) };
    case "tool_call":
      return {
        ...s,
        thinking: false,
        messages: hasCall(s.messages, ev.call.id)
          ? updateCall(s.messages, ev.call.id, ev.call)
          : withAssistant(s.messages, (p) => [...p, { type: "tool", call: ev.call }]),
      };
    case "tool_result":
      return { ...s, messages: updateCall(s.messages, ev.id, { status: ev.status, result: ev.result }) };
    case "error":
      return { ...s, error: ev.message };
    case "done":
      return { ...s, thinking: false };
    case "conversation":
    case "title":
      return s;
  }
}
