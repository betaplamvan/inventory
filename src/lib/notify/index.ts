import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, locations, notifySettings, users } from "@/db/schema";
import { appBaseUrl } from "@/lib/auth/constants";
import { fmtQty } from "@/lib/format";
import { STOCK_SEVERITY, stockState, type StockState } from "@/lib/stock";
import { emailEnabled, sendEmail } from "./email";
import { escapeHtml, sendTelegram, telegramEnabled } from "./telegram";

/**
 * Cảnh báo "sắp hết / hết hàng": gửi ngay lúc số lượng tụt qua mức tối thiểu (hoặc về 0),
 * tức đúng thời điểm ghi giao dịch — không cần bộ hẹn giờ. Chỉ áp dụng cho mặt hàng có đặt mức tối thiểu.
 * Kênh: Telegram và/hoặc email, theo cài đặt của từng tài khoản (bảng notify_settings).
 */

type Stock = { quantity: number; minQuantity: number };

/** Không lặp lại cùng một cảnh báo cho cùng mặt hàng trong khoảng này (bấm +/- qua lại quanh ngưỡng) */
const COOLDOWN_MS = 10 * 60 * 1000;
const lastAlert = new Map<string, number>();

/**
 * Gọi sau khi giao dịch đã commit. Không chờ, không ném lỗi: gửi thông báo hỏng
 * thì chỉ ghi log chứ không làm hỏng thao tác nhập/xuất.
 */
export function alertOnStockChange(userId: string, itemId: number, before: Stock, after: Stock) {
  if (after.minQuantity <= 0) return; // 0 = không theo dõi
  const prev = stockState(before.quantity, before.minQuantity);
  const next = stockState(after.quantity, after.minQuantity);
  if (STOCK_SEVERITY[next] <= STOCK_SEVERITY[prev]) return;

  const key = `${itemId}:${next}`;
  const now = Date.now();
  if (now - (lastAlert.get(key) ?? 0) < COOLDOWN_MS) return;
  if (lastAlert.size > 2000) lastAlert.clear();
  lastAlert.set(key, now);

  void sendStockAlert(userId, itemId, next).catch((err) => {
    lastAlert.delete(key);
    console.error("[notify] không gửi được cảnh báo tồn kho:", (err as Error).message);
  });
}

async function channelsOf(userId: string) {
  const [row] = await db
    .select({
      chatId: notifySettings.telegramChatId,
      emailOn: notifySettings.emailEnabled,
      email: users.email,
    })
    .from(users)
    .leftJoin(notifySettings, eq(notifySettings.userId, users.id))
    .where(eq(users.id, userId));
  return {
    telegram: telegramEnabled() && row?.chatId ? row.chatId : null,
    email: emailEnabled() && row?.emailOn ? row.email : null,
  };
}

async function locationPath(userId: string, locationId: number | null) {
  if (locationId == null) return null;
  const rows = await db
    .select({ id: locations.id, name: locations.name, parentId: locations.parentId })
    .from(locations)
    .where(eq(locations.userId, userId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parts: string[] = [];
  let cur = byId.get(locationId);
  let guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift(cur.name);
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ") || null;
}

/** Gửi nội dung tới mọi kênh đang bật; ném lỗi nếu có kênh hỏng (sau khi đã thử hết các kênh). */
async function deliver(
  to: { telegram: string | null; email: string | null },
  msg: { subject: string; text: string; html: string },
) {
  const jobs: Promise<unknown>[] = [];
  if (to.telegram) jobs.push(sendTelegram(to.telegram, msg.html));
  if (to.email) jobs.push(sendEmail(to.email, msg.subject, msg.text));
  const failed = (await Promise.allSettled(jobs)).filter((r) => r.status === "rejected");
  if (failed.length) throw new Error(failed.map((f) => (f.reason as Error).message).join("; "));
  return jobs.length;
}

async function sendStockAlert(userId: string, itemId: number, state: StockState) {
  const to = await channelsOf(userId);
  if (!to.telegram && !to.email) return;

  const [it] = await db
    .select({
      name: items.name,
      quantity: items.quantity,
      minQuantity: items.minQuantity,
      unit: items.unit,
      supplier: items.supplier,
      purchaseUrl: items.purchaseUrl,
      locationId: items.locationId,
    })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId)));
  if (!it) return;

  const title = state === "out" ? "Hết hàng" : "Sắp hết hàng";
  const stock = `Còn ${fmtQty(it.quantity)} ${it.unit} · mức tối thiểu ${fmtQty(it.minQuantity)}`;
  const location = await locationPath(userId, it.locationId);
  const url = `${appBaseUrl()}/items/${itemId}`;
  // Link mua do người dùng nhập: chỉ gắn nếu là http(s)
  const buyUrl = it.purchaseUrl && /^https?:\/\//i.test(it.purchaseUrl) ? it.purchaseUrl : null;

  const text = [
    `${title}: ${it.name}`,
    stock,
    location && `Vị trí: ${location}`,
    it.supplier && `Nhà cung cấp: ${it.supplier}`,
    buyUrl && `Link mua: ${buyUrl}`,
    `Xem trong kho: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = [
    `${state === "out" ? "🔴" : "⚠️"} <b>${title}</b>`,
    `<b>${escapeHtml(it.name)}</b>`,
    escapeHtml(stock),
    location && `📍 ${escapeHtml(location)}`,
    it.supplier && `🏪 ${escapeHtml(it.supplier)}`,
    buyUrl && `🛒 <a href="${escapeHtml(buyUrl)}">Link mua</a>`,
    `<a href="${url}">Mở trong kho</a>`,
  ]
    .filter(Boolean)
    .join("\n");

  await deliver(to, { subject: `[Kho linh kiện] ${title}: ${it.name}`, text, html });
}

/** Nút "Gửi thử" ở trang Tài khoản. Trả về số kênh đã gửi (0 = chưa bật kênh nào). */
export async function sendTestNotification(userId: string) {
  const to = await channelsOf(userId);
  return deliver(to, {
    subject: "[Kho linh kiện] Thông báo thử",
    text: `Thông báo thử từ Kho linh kiện. Khi mặt hàng tụt xuống mức tối thiểu, bạn sẽ nhận tin ở đây.\n${appBaseUrl()}`,
    html: `✅ <b>Thông báo thử</b>\nKhi mặt hàng tụt xuống mức tối thiểu, bạn sẽ nhận tin ở đây.\n<a href="${appBaseUrl()}">Mở kho</a>`,
  });
}
