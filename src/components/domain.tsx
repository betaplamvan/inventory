"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
import { Carrot, Cpu, Shirt, type LucideIcon } from "lucide-react";
import { DOMAINS, DOMAIN_CONFIG, DOMAIN_COOKIE, isDomain, type Domain } from "@/lib/domains";

/**
 * Kho đang chọn phía trình duyệt: cookie DOMAIN_COOKIE (server đọc cùng cookie này) + html[data-domain]
 * cho màu giao diện. Đổi kho = ghi cookie, đổi thuộc tính, rồi router.refresh() để server vẽ lại theo kho mới.
 */

const EVENT = "kho:domain";

function readCookie(): Domain | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${DOMAIN_COOKIE}=([a-z]+)`));
  return m && isDomain(m[1]) ? m[1] : null;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Kho hiện tại; null khi đang render phía server / trước khi hydrate */
export function useDomain(): Domain | null {
  return useSyncExternalStore(
    subscribe,
    () => readCookie() ?? "electronics",
    () => null,
  );
}

/** Ghi kho đang chọn (không tải lại trang) */
export function applyDomain(d: Domain) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${DOMAIN_COOKIE}=${d}; path=/; max-age=31536000; samesite=lax${secure}`;
  document.documentElement.dataset.domain = d;
  window.dispatchEvent(new Event(EVENT));
}

const ICONS: Record<DomainConfigIcon, LucideIcon> = { cpu: Cpu, shirt: Shirt, carrot: Carrot };
type DomainConfigIcon = (typeof DOMAIN_CONFIG)[Domain]["icon"];

export function DomainIcon({ domain, className = "size-4" }: { domain: Domain; className?: string }) {
  const Icon = ICONS[DOMAIN_CONFIG[domain].icon];
  return <Icon className={className} aria-hidden />;
}

/** Trang chi tiết của một mặt hàng thuộc kho khác → chuyển sang kho đó (màu, menu, danh sách) */
export function DomainSync({ domain }: { domain: Domain }) {
  const router = useRouter();
  useEffect(() => {
    if (readCookie() === domain || (readCookie() === null && domain === "electronics")) return;
    applyDomain(domain);
    router.refresh();
  }, [domain, router]);
  return null;
}

/** Nút chuyển kho: 3 ô Linh kiện / Quần áo / Thực phẩm. usePathname cần Suspense. */
export function DomainSwitcher({ compact = false }: { compact?: boolean }) {
  return (
    <Suspense fallback={<SwitcherView compact={compact} current={null} onPick={() => {}} />}>
      <ActiveSwitcher compact={compact} />
    </Suspense>
  );
}

function ActiveSwitcher({ compact }: { compact: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useDomain();
  const onPick = (d: Domain) => {
    if (d === current) return;
    applyDomain(d);
    // Trang gắn với 1 mặt hàng / 1 cuộc trò chuyện của kho cũ → về danh sách của kho mới
    if (/^\/items\/\d+/.test(pathname)) router.push("/items");
    else if (pathname.startsWith("/chat")) router.push("/chat");
    else router.refresh();
  };
  return <SwitcherView compact={compact} current={current} onPick={onPick} />;
}

function SwitcherView({
  compact,
  current,
  onPick,
}: {
  compact: boolean;
  current: Domain | null;
  onPick: (d: Domain) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Chọn kho"
      data-tour="domain-switch"
      className={`flex rounded-xl bg-surface-2 p-1 ${compact ? "gap-0.5" : "gap-1"}`}
    >
      {DOMAINS.map((d) => {
        const on = current === d;
        const cfg = DOMAIN_CONFIG[d];
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={cfg.space}
            title={cfg.space}
            onClick={() => onPick(d)}
            className={`flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition ${
              compact ? "size-9" : "min-w-0 flex-1 px-2 py-1.5"
            } ${on ? "bg-surface text-accent-strong shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            <DomainIcon domain={d} className={compact ? "size-4.5" : "size-4 shrink-0"} />
            {!compact && <span className="truncate">{cfg.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
