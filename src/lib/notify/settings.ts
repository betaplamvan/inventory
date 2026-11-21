import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifySettings } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { emailEnabled } from "./email";
import { botUsername, getUpdates, sendTelegram, telegramEnabled, type TelegramUpdate } from "./telegram";

/** Mã kết nối Telegram sống bao lâu */
const LINK_MINUTES = 15;

export type NotifyStatus = {
  telegram: { available: boolean; linkedAs: string | null; pending: boolean };
  email: { available: boolean; enabled: boolean };
};

export async function getNotifyStatus(userId: string): Promise<NotifyStatus> {
  const [row] = await db
    .select({
      chatId: notifySettings.telegramChatId,
      name: notifySettings.telegramName,
      emailOn: notifySettings.emailEnabled,
      pending: sql<boolean>`${notifySettings.linkCodeHash} is not null and ${notifySettings.linkCodeExpiresAt} > now()`,
    })
    .from(notifySettings)
    .where(eq(notifySettings.userId, userId));
  return {
    telegram: {
      available: telegramEnabled(),
      linkedAs: row?.chatId ? row.name || "Telegram" : null,
      pending: !!row?.pending,
    },
    email: { available: emailEnabled(), enabled: !!row?.emailOn },
  };
}

async function upsert(userId: string, values: Partial<typeof notifySettings.$inferInsert>) {
  await db
    .insert(notifySettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: notifySettings.userId, set: { ...values, updatedAt: new Date() } });
}

export async function setEmailEnabled(userId: string, enabled: boolean) {
  await upsert(userId, { emailEnabled: enabled });
}

export async function unlinkTelegram(userId: string) {
  await upsert(userId, { telegramChatId: null, telegramName: null, linkCodeHash: null, linkCodeExpiresAt: null });
}

/**
 * Bắt đầu kết nối: tạo mã dùng 1 lần (DB chỉ lưu SHA-256) và trả link t.me/<bot>?start=<mã>.
 * Người dùng mở link, bấm Start → bot nhận "/start <mã>" → pollTelegramLinks() khớp mã và lưu chat id.
 */
export async function startTelegramLink(userId: string) {
  const username = await botUsername();
  const code = randomToken();
  await upsert(userId, {
    linkCodeHash: sha256(code),
    linkCodeExpiresAt: sql`now() + ${`${LINK_MINUTES} minutes`}::interval` as never,
  });
  return `https://t.me/${username}?start=${code}`;
}

let polling: Promise<void> | null = null;

/**
 * Đọc tin nhắn mới gửi tới bot và hoàn tất mọi yêu cầu kết nối đang chờ (của bất kỳ tài khoản nào),
 * rồi xác nhận đã xử lý. Các lần gọi đồng thời dùng chung 1 lượt đọc.
 */
export function pollTelegramLinks() {
  polling ??= doPoll().finally(() => {
    polling = null;
  });
  return polling;
}

const chatName = (m: NonNullable<TelegramUpdate["message"]>) =>
  m.chat.type === "private"
    ? m.from?.username
      ? `@${m.from.username}`
      : m.from?.first_name || "Telegram"
    : m.chat.title || "Nhóm Telegram";

async function doPoll() {
  const updates = await getUpdates();
  if (!updates.length) return;

  for (const u of updates) {
    const m = u.message;
    // "/start <mã>" (chat riêng) hoặc "/start@ten_bot <mã>" (trong nhóm)
    const code = m?.text?.match(/^\/start(?:@\w+)?\s+([\w-]{20,64})\s*$/)?.[1];
    if (!m || !code) continue;
    const chatId = String(m.chat.id);
    const [linked] = await db
      .update(notifySettings)
      .set({
        telegramChatId: chatId,
        telegramName: chatName(m),
        linkCodeHash: null,
        linkCodeExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(notifySettings.linkCodeHash, sha256(code)), gt(notifySettings.linkCodeExpiresAt, sql`now()`)))
      .returning({ userId: notifySettings.userId });
    await sendTelegram(
      chatId,
      linked
        ? "✅ Đã kết nối với <b>Kho đồ</b>. Bạn sẽ nhận cảnh báo khi mặt hàng sắp hết."
        : "Mã kết nối sai hoặc đã hết hạn. Hãy bấm lại <b>Kết nối Telegram</b> trong trang Tài khoản của app.",
    ).catch((err) => console.error("[notify] không trả lời được trên Telegram:", (err as Error).message));
  }

  // Xác nhận đã xử lý tới update cuối → Telegram không gửi lại
  await getUpdates(updates[updates.length - 1].update_id + 1);
}
