"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
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
import type { ChatDecision, UiToolCall, UiToolStatus } from "@/lib/chat/types";
import { ChatMarkdown } from "./markdown";
import { decide, isDraft, openConversation, sendMessage, stop, useChatState } from "./store";

const SUGGESTIONS = [
  "Mặt hàng nào sắp hết cần mua thêm?",
  "Tổng giá trị kho hiện tại là bao nhiêu?",
  "Tìm tụ gốm 100nF",
  "Nhập thêm 10 con điện trở 10k",
];

/**
 * Khung chat cho 1 cuộc trò chuyện. Trạng thái và kết nối stream nằm trong store dùng chung (./store),
 * nên panel unmount (chuyển trang, đóng khung nổi) KHÔNG làm dừng câu trả lời đang chạy;
 * panel khác mở cùng cuộc trò chuyện thấy tiếp tục ngay.
 */
type Props = {
  /** id cuộc trò chuyện, hoặc khoá nháp "new:…" (newDraftKey) cho cuộc mới */
  conversationKey: string;
  /** Cuộc trò chuyện mới vừa được tạo (khi gửi tin đầu tiên) */
  onCreated?: (id: string, title: string) => void;
  /** Cuộc trò chuyện không còn (đã xoá) */
  onNotFound?: () => void;
  compact?: boolean;
};

export function ChatPanel({ conversationKey, onCreated, onNotFound, compact }: Props) {
  const { messages, status, thinking, error } = useChatState(conversationKey);
  const streaming = status === "streaming";
  const loading = status === "loading";
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handleNotFound = useEffectEvent(() => onNotFound?.());

  // Mở cuộc trò chuyện: tải lịch sử, hoặc nối vào lượt trả lời đang chạy nền
  useEffect(() => {
    if (isDraft(conversationKey)) return;
    stickRef.current = true;
    void openConversation(conversationKey).then((r) => {
      if (r === "notfound") handleNotFound();
    });
  }, [conversationKey]);

  // Tự cuộn xuống khi có nội dung mới, trừ khi người dùng đã cuộn lên đọc
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = (text: string) => {
    if (!text.trim() || streaming) return;
    setInput("");
    stickRef.current = true;
    sendMessage(conversationKey, text, onCreated);
  };

  const onDecide = (call: UiToolCall, decision: ChatDecision) => {
    stickRef.current = true;
    decide(conversationKey, call, decision);
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
                        onDecide={(d) => onDecide(p.call, d)}
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
              onClick={() => stop(conversationKey)}
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
