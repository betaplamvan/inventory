"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { sendTestNotification } from "@/lib/notify";
import {
  getNotifyStatus,
  pollTelegramLinks,
  setEmailEnabled,
  startTelegramLink,
  unlinkTelegram,
} from "@/lib/notify/settings";

export type NotifyResult = { ok: true; message?: string; url?: string; linked?: boolean } | { ok: false; error: string };

const fail = (err: unknown): NotifyResult => ({ ok: false, error: (err as Error).message || "Có lỗi xảy ra" });

/** Tạo link t.me/<bot>?start=<mã> để người dùng mở và bấm Start. */
export async function connectTelegram(): Promise<NotifyResult> {
  const me = await requireUser();
  try {
    const url = await startTelegramLink(me.id);
    revalidatePath("/account");
    return { ok: true, url };
  } catch (err) {
    return fail(err);
  }
}

/** Đọc tin nhắn mới của bot xem người dùng đã bấm Start chưa. */
export async function checkTelegram(): Promise<NotifyResult> {
  const me = await requireUser();
  try {
    await pollTelegramLinks();
    const status = await getNotifyStatus(me.id);
    if (status.telegram.linkedAs) revalidatePath("/account");
    return { ok: true, linked: !!status.telegram.linkedAs };
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectTelegram(): Promise<NotifyResult> {
  const me = await requireUser();
  await unlinkTelegram(me.id);
  revalidatePath("/account");
  return { ok: true };
}

export async function toggleEmailAlerts(enabled: boolean): Promise<NotifyResult> {
  const me = await requireUser();
  await setEmailEnabled(me.id, !!enabled);
  revalidatePath("/account");
  return { ok: true };
}

export async function sendTestAlert(): Promise<NotifyResult> {
  const me = await requireUser();
  try {
    const sent = await sendTestNotification(me.id);
    return sent
      ? { ok: true, message: `Đã gửi thông báo thử qua ${sent} kênh.` }
      : { ok: false, error: "Chưa bật kênh thông báo nào." };
  } catch (err) {
    return fail(err);
  }
}
