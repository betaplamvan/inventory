"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BellRing, ExternalLink, Loader2, Mail, Send } from "lucide-react";
import {
  checkTelegram,
  connectTelegram,
  disconnectTelegram,
  sendTestAlert,
  toggleEmailAlerts,
  type NotifyResult,
} from "@/actions/notify";
import type { NotifyStatus } from "@/lib/notify/settings";

/** Chờ người dùng bấm Start trong Telegram tối đa bao lâu (khớp hạn mã kết nối) */
const WAIT_MS = 15 * 60 * 1000;

export function NotifyPanel({ status, email }: { status: NotifyStatus; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const since = useRef(0);

  const show = (r: NotifyResult, okText?: string) => {
    if (!r.ok) setMsg({ ok: false, text: r.error });
    else if (okText || r.message) setMsg({ ok: true, text: okText ?? r.message! });
  };

  // Đang chờ: cứ vài giây hỏi máy chủ xem bot đã nhận "/start <mã>" chưa
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      const r = await checkTelegram().catch(() => null);
      if (stop) return;
      if (r?.ok && r.linked) {
        setWaiting(false);
        setLinkUrl(null);
        setMsg({ ok: true, text: "Đã kết nối Telegram." });
        router.refresh();
        return;
      }
      if (Date.now() - since.current > WAIT_MS) {
        setWaiting(false);
        setMsg({ ok: false, text: "Hết thời gian chờ. Bấm Kết nối Telegram để lấy link mới." });
        return;
      }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 2000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [waiting, router]);

  const tg = status.telegram;
  const none = !tg.available && !status.email.available;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Báo ngay khi một mặt hàng tụt xuống <b className="text-foreground">mức tối thiểu</b> hoặc hết hàng (chỉ những món có
        đặt mức tối thiểu), dù thay đổi đến từ web, agent hay nhập file.
      </p>

      {none && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          Máy chủ chưa cấu hình kênh nào. Quản trị cần đặt <span className="font-mono">TELEGRAM_BOT_TOKEN</span> và / hoặc{" "}
          <span className="font-mono">SMTP_HOST</span> (xem README).
        </p>
      )}

      {tg.available && (
        <div className="flex flex-wrap items-center gap-3">
          <Send className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Telegram</p>
            <p className="truncate text-xs text-muted">{tg.linkedAs ? `Đã kết nối: ${tg.linkedAs}` : "Chưa kết nối"}</p>
          </div>
          {tg.linkedAs ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pending}
              onClick={() => start(async () => show(await disconnectTelegram(), "Đã ngắt Telegram."))}
            >
              Ngắt kết nối
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMsg(null);
                  const r = await connectTelegram();
                  if (!r.ok || !r.url) return show(r);
                  setLinkUrl(r.url);
                  since.current = Date.now();
                  setWaiting(true);
                  // Mở luôn app Telegram; nếu trình duyệt chặn popup thì vẫn còn nút bên dưới
                  window.open(r.url, "_blank", "noopener");
                })
              }
            >
              Kết nối Telegram
            </button>
          )}
        </div>
      )}

      {linkUrl && waiting && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 text-accent-strong">
            <Loader2 className="size-4 shrink-0 animate-spin" /> Mở Telegram và bấm <b>Start</b> (Bắt đầu) trong chat với bot…
          </p>
          <a href={linkUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
            Mở lại link <ExternalLink className="size-3" />
          </a>
          <p className="mt-1 text-xs text-muted">Muốn nhận trong nhóm: thêm bot vào nhóm rồi gửi lệnh /start kèm mã trong link.</p>
        </div>
      )}

      {status.email.available && (
        <label className="flex cursor-pointer items-center gap-3">
          <Mail className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-medium">Email</span>
            <span className="block truncate text-xs text-muted">{email}</span>
          </span>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            defaultChecked={status.email.enabled}
            disabled={pending}
            onChange={(e) => {
              const on = e.target.checked;
              start(async () => show(await toggleEmailAlerts(on), on ? "Đã bật email." : "Đã tắt email."));
            }}
          />
        </label>
      )}

      {(tg.linkedAs || status.email.enabled) && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={pending}
          onClick={() => start(async () => show(await sendTestAlert()))}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />} Gửi thử
        </button>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-accent-strong" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
