"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Loader2,
  Search,
  ShieldQuestion,
  Square,
  Wrench,
  X,
} from "lucide-react";
import type { ChatDecision, ChatStreamEvent, UiMessage, UiPart, UiToolCall, UiToolStatus } from "@/lib/chat/types";
import { ChatMarkdown } from "./markdown";

const SUGGESTIONS = [
  "Mặt hàng nào sắp hết cần mua thêm?",
  "Tổng giá trị kho hiện tại là bao nhiêu?",
  "Tìm tụ gốm 100nF",
  "Nhập thêm 10 con điện trở 10k",
];

/**
 * Khung chat cho 1 cuộc trò chuyện. Đổi sang cuộc khác thì parent đổi `key` để mount lại;
 * cuộc mới do chính panel tạo (gửi tin đầu tiên) thì giữ nguyên panel, báo lên qua onCreated.
 */
type Props = {
  initialId: string | null;
  /** Cuộc trò chuyện mới vừa được tạo (khi gửi tin đầu tiên) */
  onCreated?: (id: string, title: string) => void;
  /** Có hoạt động mới (để danh sách cuộc trò chuyện cập nhật thứ tự) */
  onActivity?: () => void;
  /** Cuộc trò chuyện không còn (đã xoá) */
  onNotFound?: () => void;
  compact?: boolean;
};

let tempId = 0;
const nextTemp = () => `tmp-${++tempId}`;

/* ---------------- Cập nhật danh sách tin nhắn (bất biến) ---------------- */

function withAssistant(msgs: UiMessage[], fn: (parts: UiPart[]) => UiPart[]): UiMessage[] {
  const last = msgs.at(-1);
  if (last?.role === "assistant") return [...msgs.slice(0, -1), { ...last, parts: fn(last.parts) }];
  return [...msgs, { id: nextTemp(), role: "assistant", parts: fn([]) }];
}

function appendText(parts: UiPart[], delta: string): UiPart[] {
  const last = parts.at(-1);
  if (last?.type === "text") return [...parts.slice(0, -1), { type: "text", text: last.text + delta }];
  return [...parts, { type: "text", text: delta }];
}

function updateCall(msgs: UiMessage[], id: string, patch: Partial<UiToolCall>): UiMessage[] {
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

const awaitingCalls = (msgs: UiMessage[]) =>
  msgs.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool" && p.call.status === "awaiting" ? [p.call] : [])));

/* ---------------- Component ---------------- */

export function ChatPanel({ initialId, onCreated, onActivity, onNotFound, compact }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(!!initialId);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [decisions, setDecisions] = useState<Record<string, ChatDecision>>({});

  const convRef = useRef<string | null>(initialId);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mount với cuộc trò chuyện có sẵn → tải tin nhắn; unmount → dừng stream đang chạy
  useEffect(() => {
    const ctrl = new AbortController();
    if (initialId) {
      fetch(`/api/chat/conversations/${initialId}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (res.status === 404 && onNotFound) {
            setMessages([]);
            onNotFound();
            return;
          }
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Không tải được cuộc trò chuyện");
          const data = (await res.json()) as { messages: UiMessage[] };
          setMessages(data.messages);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(err.message);
        })
        .finally(() => setLoading(false));
    }
    return () => {
      ctrl.abort();
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi mount (mỗi cuộc trò chuyện 1 lần mount)
  }, []);

  // Tự cuộn xuống khi có nội dung mới, trừ khi người dùng đã cuộn lên đọc
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const run = useCallback(
    async (body: { message?: string; decisions?: Record<string, ChatDecision> }) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);
      setThinking(false);
      setError(null);
      stickRef.current = true;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: convRef.current, ...body }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error((await res.json().catch(() => null))?.error ?? `Lỗi ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            handle(JSON.parse(line.slice(5)) as ChatStreamEvent);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message || "Mất kết nối");
      } finally {
        setStreaming(false);
        setThinking(false);
        abortRef.current = null;
        onActivity?.();
      }

      function handle(ev: ChatStreamEvent) {
        switch (ev.type) {
          case "conversation":
            convRef.current = ev.id;
            onCreated?.(ev.id, ev.title);
            break;
          case "user":
            // Thay id tạm của tin nhắn vừa gửi bằng id thật
            setMessages((m) => {
              const i = m.findLastIndex((x) => x.role === "user");
              return i < 0 ? m : m.map((x, j) => (j === i ? { ...x, id: ev.message.id } : x));
            });
            break;
          case "thinking":
            setThinking(true);
            break;
          case "text":
            setThinking(false);
            setMessages((m) => withAssistant(m, (p) => appendText(p, ev.delta)));
            break;
          case "tool_call":
            setThinking(false);
            setMessages((m) => withAssistant(m, (p) => [...p, { type: "tool", call: ev.call }]));
            break;
          case "tool_result":
            setMessages((m) => updateCall(m, ev.id, { status: ev.status, result: ev.result }));
            break;
          case "error":
            setError(ev.message);
            break;
          case "done":
            break;
        }
      }
    },
    [onActivity, onCreated],
  );

  const send = (text: string) => {
    const t = text.trim();
    if (!t || streaming) return;
    setInput("");
    setDecisions({});
    // Gửi tin mới khi còn thao tác chờ xác nhận → server tự bỏ qua các thao tác đó
    setMessages((m) => [
      ...awaitingCalls(m).reduce((acc, c) => updateCall(acc, c.id, { status: "rejected", result: "Đã bỏ qua" }), m),
      { id: nextTemp(), role: "user", parts: [{ type: "text", text: t }] },
    ]);
    void run({ message: t });
  };

  const decide = (call: UiToolCall, decision: ChatDecision) => {
    if (streaming) return;
    const next = { ...decisions, [call.id]: decision };
    const pending = awaitingCalls(messages);
    setMessages((m) =>
      updateCall(m, call.id, {
        status: decision === "approve" ? "running" : "rejected",
      }),
    );
    if (pending.every((c) => next[c.id])) {
      setDecisions({});
      void run({ decisions: next });
    } else {
      setDecisions(next);
    }
  };

  const empty = !loading && messages.length === 0;
  const last = messages.at(-1);
  const showPending = streaming && (thinking || last?.role !== "assistant" || last.parts.at(-1)?.type === "tool");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-3 py-3" : "px-3 py-4 sm:px-5"}`}
      >
        {loading && (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Đang tải…
          </p>
        )}

        {empty && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-strong">
              <Bot className="size-6" />
            </span>
            <div>
              <p className="font-semibold">Trợ lý kho linh kiện</p>
              <p className="mt-1 text-sm text-muted">
                Hỏi về hàng tồn, tìm linh kiện, thêm hay nhập / xuất kho. Thao tác thay đổi dữ liệu luôn chờ bạn bấm xác
                nhận.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn-secondary btn-sm rounded-full px-3"
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-sm whitespace-pre-wrap text-foreground">
                  {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                  <Bot className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {m.parts.map((p, i) =>
                    p.type === "text" ? (
                      <ChatMarkdown key={i} text={p.text} />
                    ) : p.call.write ? (
                      <ApprovalCard
                        key={p.call.id}
                        call={p.call}
                        disabled={streaming}
                        onDecide={(d) => decide(p.call, d)}
                      />
                    ) : (
                      <ToolChip key={p.call.id} call={p.call} />
                    ),
                  )}
                </div>
              </div>
            ),
          )}

          {showPending && (
            <div className="flex items-center gap-2 pl-9 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> {thinking ? "Đang suy nghĩ…" : "Đang xử lý…"}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </div>
      </div>

      <form
        className={`border-t border-border bg-surface ${compact ? "p-2" : "p-3"}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={8000}
            placeholder="Nhắn cho trợ lý…"
            aria-label="Tin nhắn"
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              // Enter gửi, Shift+Enter xuống dòng; bỏ qua khi bộ gõ (Telex/IME) đang ghép chữ
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
                if (inputRef.current) inputRef.current.style.height = "auto";
              }
            }}
            className="input max-h-40 min-h-10 resize-none py-2"
          />
          {streaming ? (
            <button
              type="button"
              className="btn-secondary size-10 shrink-0 p-0"
              onClick={() => abortRef.current?.abort()}
              aria-label="Dừng"
              title="Dừng"
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              className="btn-primary size-10 shrink-0 p-0"
              disabled={!input.trim()}
              aria-label="Gửi"
              title="Gửi"
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ---------------- Tool đọc: dòng nhỏ, bấm để xem chi tiết ---------------- */

function ToolChip({ call }: { call: UiToolCall }) {
  return (
    <details className="group text-xs text-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-border px-2.5 py-1 select-none hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {call.status === "running" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : call.status === "error" ? (
          <CircleAlert className="size-3.5 text-danger" />
        ) : (
          <Search className="size-3.5" />
        )}
        {call.title}
        <ChevronRight className="size-3 transition group-open:rotate-90" />
      </summary>
      <ToolDetails call={call} />
    </details>
  );
}

function ToolDetails({ call }: { call: UiToolCall }) {
  return (
    <div className="mt-1.5 space-y-1.5 rounded-lg border border-border bg-surface-2/50 p-2">
      <p className="font-mono">{call.name}</p>
      <pre className="max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
        {JSON.stringify(call.args, null, 2)}
      </pre>
      {call.result && (
        <pre className="max-h-60 overflow-auto border-t border-border pt-1.5 font-mono text-[11px] whitespace-pre-wrap">
          {call.result}
        </pre>
      )}
    </div>
  );
}

/* ---------------- Tool ghi: thẻ xác nhận ---------------- */

const ARG_LABELS: Record<string, string> = {
  id: "Mã mặt hàng (id)",
  sku: "SKU",
  name: "Tên",
  newSku: "SKU mới",
  kind: "Loại",
  type: "Thao tác",
  amount: "Số lượng",
  quantity: "Số lượng",
  unit: "Đơn vị",
  unitPrice: "Đơn giá",
  minQuantity: "Mức tối thiểu",
  category: "Danh mục",
  location: "Vị trí",
  parent: "Thuộc",
  reference: "Tham chiếu",
  note: "Ghi chú",
  notes: "Ghi chú",
  description: "Mô tả",
  supplier: "Nhà cung cấp",
  manufacturer: "Hãng",
  package: "Package",
  code: "Mã",
};
const MOVEMENT: Record<string, string> = {
  in: "Nhập thêm",
  out: "Lấy ra dùng",
  adjust: "Kiểm kê (đặt số lượng)",
};

function fmtValue(key: string, v: unknown): string {
  if (key === "type" && typeof v === "string" && MOVEMENT[v]) return MOVEMENT[v];
  if (key === "unitPrice" && typeof v === "number") return `${v.toLocaleString("vi-VN")} ₫`;
  if (typeof v === "number") return v.toLocaleString("vi-VN");
  if (typeof v === "boolean") return v ? "có" : "không";
  if (v === null) return "(xoá)";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

const STATUS: Record<Exclude<UiToolStatus, "awaiting">, { label: string; className: string }> = {
  running: { label: "Đang thực hiện…", className: "text-muted" },
  ok: { label: "Đã thực hiện", className: "text-accent-strong" },
  error: { label: "Lỗi", className: "text-danger" },
  rejected: { label: "Đã bỏ qua", className: "text-muted" },
};

function ApprovalCard({
  call,
  disabled,
  onDecide,
}: {
  call: UiToolCall;
  disabled: boolean;
  onDecide: (d: ChatDecision) => void;
}) {
  const args = call.args && typeof call.args === "object" ? Object.entries(call.args as Record<string, unknown>) : [];
  const simple = args.filter(([, v]) => v === null || typeof v !== "object");
  const complex = args.filter(([, v]) => v !== null && typeof v === "object");
  const awaiting = call.status === "awaiting";
  const st = STATUS[call.status === "awaiting" ? "running" : call.status];

  return (
    <div
      className={`rounded-xl border p-3 text-sm ${awaiting ? "border-accent/60 bg-accent-soft/30" : "border-border"}`}
    >
      <p className="flex items-center gap-2 font-medium">
        {awaiting ? <ShieldQuestion className="size-4 text-accent-strong" /> : <Wrench className="size-4 text-muted" />}
        {call.title}
        {!awaiting && (
          <span className={`ml-auto flex items-center gap-1 text-xs font-normal ${st.className}`}>
            {call.status === "running" && <Loader2 className="size-3 animate-spin" />}
            {call.status === "ok" && <Check className="size-3.5" />}
            {st.label}
          </span>
        )}
      </p>
      {call.subject && (
        <p className="mt-1 text-xs text-muted">
          Mặt hàng: <b className="text-foreground">{call.subject}</b>
        </p>
      )}

      {awaiting && (
        <>
          {simple.length > 0 && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {simple.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{ARG_LABELS[k] ?? k}</dt>
                  <dd className="break-words">{fmtValue(k, v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {complex.map(([k, v]) => (
            <details key={k} className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted">
                {ARG_LABELS[k] ?? k}
                {Array.isArray(v) ? ` (${v.length})` : ""}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {JSON.stringify(v, null, 2)}
              </pre>
            </details>
          ))}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm px-3"
              disabled={disabled}
              onClick={() => onDecide("approve")}
            >
              <Check className="size-3.5" /> Xác nhận
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm px-3"
              disabled={disabled}
              onClick={() => onDecide("reject")}
            >
              <X className="size-3.5" /> Bỏ qua
            </button>
          </div>
        </>
      )}

      {!awaiting && (call.result || args.length > 0) && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer">Chi tiết</summary>
          <ToolDetails call={call} />
        </details>
      )}
    </div>
  );
}
