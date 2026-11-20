import "server-only";

/**
 * Bot Telegram dùng chung cho cả máy chủ (TELEGRAM_BOT_TOKEN, tạo bằng @BotFather).
 * Chỉ gọi ra api.telegram.org — không cần webhook hay mở cổng vào.
 */

const apiBase = () => (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");

export const telegramEnabled = () => !!process.env.TELEGRAM_BOT_TOKEN;

export class TelegramError extends Error {}

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError("Máy chủ chưa cấu hình TELEGRAM_BOT_TOKEN");
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    // Không đưa err vào thông báo: URL có chứa bot token
    throw new TelegramError("Không kết nối được tới Telegram");
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!data?.ok) throw new TelegramError(`Telegram: ${data?.description ?? `HTTP ${res.status}`}`);
  return data.result as T;
}

let cachedUsername: string | null = null;

/** Tên bot (không có @) để tạo link t.me/<bot>?start=… */
export async function botUsername() {
  if (!cachedUsername) cachedUsername = (await call<{ username: string }>("getMe")).username;
  return cachedUsername;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Gửi tin nhắn (parse_mode HTML — nhớ escapeHtml phần nội dung do người dùng nhập). */
export async function sendTelegram(chatId: string, html: string) {
  await call("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string; title?: string; username?: string; first_name?: string };
    from?: { username?: string; first_name?: string };
  };
};

/** Tin nhắn mới gửi tới bot (tối đa 100, cũ nhất trước). offset = xác nhận đã xử lý các update trước đó. */
export function getUpdates(offset?: number) {
  return call<TelegramUpdate[]>("getUpdates", {
    timeout: 0,
    limit: 100,
    allowed_updates: ["message"],
    ...(offset != null ? { offset } : {}),
  });
}
