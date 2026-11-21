/** Kiểu dữ liệu chat dùng chung cho server (API) và giao diện. */

/** awaiting = thao tác ghi đang chờ người dùng xác nhận */
export type UiToolStatus = "awaiting" | "running" | "ok" | "error" | "rejected";

export type UiToolCall = {
  id: string;
  name: string;
  title: string;
  /** tham số đã parse (hoặc chuỗi gốc nếu không phải JSON) */
  args: unknown;
  write: boolean;
  /** Tên mặt hàng mà thao tác ghi nhắm tới (tra từ id / sku) — hiện trên thẻ xác nhận */
  subject?: string;
  status: UiToolStatus;
  result?: string;
};

export type UiPart = { type: "text"; text: string } | { type: "tool"; call: UiToolCall };

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  parts: UiPart[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ChatDecision = "approve" | "reject";

/** Sự kiện stream (SSE) của POST /api/chat */
export type ChatStreamEvent =
  /** Nối vào lượt đang chạy: trạng thái trước lượt này, các sự kiện sau đó được phát lại từ đầu lượt */
  | { type: "snapshot"; messages: UiMessage[] }
  | { type: "conversation"; id: string; title: string }
  /** Tiêu đề do trợ lý tự đặt sau câu trả lời đầu tiên */
  | { type: "title"; id: string; title: string }
  | { type: "user"; message: UiMessage }
  | { type: "thinking" }
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: UiToolCall }
  | { type: "tool_result"; id: string; status: UiToolStatus; result: string }
  | { type: "done"; awaiting: boolean }
  | { type: "error"; message: string };
