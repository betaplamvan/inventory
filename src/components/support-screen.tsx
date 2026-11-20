"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { vietqrPayload } from "@/lib/vietqr";

const TIERS = [
  { amount: 20000, label: "Ly cà phê" },
  { amount: 50000, label: "Bữa trưa" },
  { amount: 100000, label: "Tiếp sức" },
] as const;
const MIN_CUSTOM = 10000;

type Bank = { readonly bin: string; readonly name: string; readonly accountNo: string; readonly accountName: string };

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

/** Chọn mốc / nhập số tiền → mã VietQR sinh ngay tại trình duyệt, kèm thông tin chuyển khoản tay. */
export function SupportScreen({ bank, note }: { bank: Bank; note: string }) {
  const [tier, setTier] = useState<number>(50000);
  const [custom, setCustom] = useState("");
  const [qr, setQr] = useState<{ payload: string; url: string } | null>(null);

  const customValue = Number(custom.replace(/\D/g, "")) || 0;
  const amount = custom ? customValue : tier;
  const tooSmall = !!custom && customValue < MIN_CUSTOM;
  const payload = tooSmall ? null : vietqrPayload({ bin: bank.bin, accountNo: bank.accountNo, amount, note });

  // Sinh ảnh QR (bất đồng bộ); đổi số tiền thì ảnh cũ bị bỏ
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    void import("qrcode").then(({ toDataURL }) =>
      toDataURL(payload, { margin: 1, width: 440, errorCorrectionLevel: "M" }).then((url) => {
        if (alive) setQr({ payload, url });
      }),
    );
    return () => {
      alive = false;
    };
  }, [payload]);
  const qrUrl = payload && qr?.payload === payload ? qr.url : null;

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4 sm:p-5" data-tour="support-tiers">
        <h2 className="text-sm font-semibold">Chọn số tiền</h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {TIERS.map((t) => {
            const active = !custom && tier === t.amount;
            return (
              <button
                key={t.amount}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTier(t.amount);
                  setCustom("");
                }}
                className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-2 py-3 transition active:scale-[0.97] sm:py-4 ${
                  active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/60"
                }`}
              >
                <span className="text-lg font-bold tabular-nums sm:text-2xl">{fmt(t.amount)}đ</span>
                <span className="text-xs font-medium text-muted sm:text-sm">{t.label}</span>
              </button>
            );
          })}
        </div>
        <div>
          <label htmlFor="support-custom" className="label">
            Hoặc nhập số khác (tối thiểu {fmt(MIN_CUSTOM)}đ)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="support-custom"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              inputMode="numeric"
              placeholder="VD: 30000"
              className="input max-w-48 tabular-nums"
              aria-invalid={tooSmall}
            />
            {custom && !tooSmall && <span className="text-sm text-muted tabular-nums">= {fmt(customValue)}đ</span>}
          </div>
          {tooSmall && <p className="mt-1 text-xs text-danger">Tối thiểu {fmt(MIN_CUSTOM)}đ.</p>}
        </div>
      </section>

      <section className="card p-4 sm:p-5" data-tour="support-qr">
        <h2 className="mb-3 text-sm font-semibold">Quét mã bằng app ngân hàng</h2>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="grid size-56 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white p-1.5">
            {qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh QR sinh tại chỗ (data URL)
              <img src={qrUrl} alt={`Mã VietQR chuyển ${fmt(amount)}đ, nội dung ${note}`} className="size-full" />
            ) : (
              <span className="px-4 text-center text-xs text-zinc-500">{tooSmall ? "Nhập số tiền hợp lệ" : "Đang tạo mã…"}</span>
            )}
          </div>
          <dl className="w-full min-w-0 flex-1 space-y-2 text-sm">
            {bank.name && <Row label="Ngân hàng" value={bank.name} />}
            <Row label="Số tài khoản" value={bank.accountNo} copy mono />
            {bank.accountName && <Row label="Chủ tài khoản" value={bank.accountName} />}
            <Row label="Nội dung" value={note} copy mono />
            <Row label="Số tiền" value={tooSmall ? "—" : `${fmt(amount)}đ`} />
            <p className="pt-1 text-xs text-muted">
              Mở app ngân hàng và quét mã: số tiền, nội dung đã điền sẵn. Chuyển khoản tay thì theo thông tin trên.
            </p>
          </dl>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, copy, mono }: { label: string; value: string; copy?: boolean; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className={`truncate font-semibold ${mono ? "font-mono" : ""}`}>{value}</span>
        {copy && (
          <button
            type="button"
            aria-label={`Chép ${label.toLowerCase()}`}
            title="Chép"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground pointer-coarse:size-10"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setDone(true);
                setTimeout(() => setDone(false), 1500);
              } catch {}
            }}
          >
            {done ? <Check className="size-4 text-accent-strong" /> : <Copy className="size-4" />}
          </button>
        )}
      </dd>
    </div>
  );
}
