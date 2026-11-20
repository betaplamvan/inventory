"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Boxes,
  Cpu,
  FileUp,
  FolderTree,
  LayoutDashboard,
  MapPin,
  Menu,
  Plus,
  ScanLine,
  Trash2,
} from "lucide-react";

const LINKS = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard, exact: true },
  { href: "/items", label: "Kho hàng", icon: Boxes },
  { href: "/movements", label: "Nhập / Xuất", icon: ArrowLeftRight },
  { href: "/scan", label: "Quét mã", icon: ScanLine },
  { href: "/categories", label: "Danh mục", icon: FolderTree },
  { href: "/locations", label: "Vị trí cất", icon: MapPin },
  { href: "/import", label: "Nhập từ file", icon: FileUp },
  { href: "/trash", label: "Thùng rác", icon: Trash2 },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-accent text-white dark:text-black">
        <Cpu className="size-4.5" />
      </span>
      <span>Kho linh kiện</span>
    </Link>
  );
}

type NavProps = { lowStockBadge: ReactNode; onNavigate?: () => void };

/** usePathname trên route động cần Suspense; fallback là menu không đánh dấu mục đang mở */
function NavLinks(props: NavProps) {
  return (
    <Suspense fallback={<NavList {...props} pathname={null} />}>
      <ActiveNavLinks {...props} />
    </Suspense>
  );
}

function ActiveNavLinks(props: NavProps) {
  const pathname = usePathname();
  return <NavList {...props} pathname={pathname} />;
}

function NavList({ lowStockBadge, onNavigate, pathname }: NavProps & { pathname: string | null }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = pathname != null && (exact ? pathname === href : pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-accent-soft text-accent-strong"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {href === "/items" && lowStockBadge}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppNav({ lowStockBadge, userMenu }: { lowStockBadge: ReactNode; userMenu: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Brand />
      <Link href="/items/new" className="btn-primary">
        <Plus className="size-4" /> Thêm mặt hàng
      </Link>
      <NavLinks lowStockBadge={lowStockBadge} />
      <div className="mt-auto">{userMenu}</div>
    </div>
  );
}

type MobileNavProps = { lowStockBadge: ReactNode; userMenu: ReactNode };

/** Điện thoại / tablet: thanh thương hiệu mỏng ở trên + thanh tab cố định ở đáy (vừa tầm ngón cái). */
export function MobileNav(props: MobileNavProps) {
  return (
    <>
      <header className="border-b border-border bg-surface pt-[env(safe-area-inset-top)] lg:hidden print:hidden">
        <div className="flex h-12 items-center justify-between pr-1.5 pl-4">
          <Brand />
          <Link
            href="/scan"
            aria-label="Quét mã"
            title="Quét mã"
            className="grid size-11 place-items-center rounded-lg text-muted active:bg-surface-2"
          >
            <ScanLine className="size-5.5" />
          </Link>
        </div>
      </header>
      <Suspense fallback={<TabBar {...props} pathname={null} />}>
        <ActiveTabBar {...props} />
      </Suspense>
    </>
  );
}

function ActiveTabBar(props: MobileNavProps) {
  const pathname = usePathname();
  return <TabBar {...props} pathname={pathname} />;
}

const [HOME, ITEMS, MOVEMENTS, ...MORE_LINKS] = LINKS;

function TabBar({ lowStockBadge, userMenu, pathname }: MobileNavProps & { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const isActive = (l: (typeof LINKS)[number]) =>
    pathname != null && (l.exact ? pathname === l.href : pathname.startsWith(l.href));
  const moreActive = pathname != null && (MORE_LINKS.some(isActive) || pathname.startsWith("/account"));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const tab = (l: (typeof LINKS)[number], badge?: ReactNode) => {
    const active = !open && isActive(l);
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={close}
        aria-current={active ? "page" : undefined}
        className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition active:scale-95 ${
          active ? "text-accent-strong" : "text-muted"
        }`}
      >
        <span className="relative">
          <l.icon className="size-5.5" />
          {badge && <span className="absolute -top-2 left-3.5 rounded-full bg-surface">{badge}</span>}
        </span>
        {l.label}
      </Link>
    );
  };

  return (
    <div className="lg:hidden print:hidden">
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] space-y-2 overflow-y-auto rounded-t-2xl border-t border-border bg-surface px-4 pt-2 pb-[calc(var(--tabbar)+0.75rem)] shadow-2xl"
          >
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-border" />
            <nav className="flex flex-col gap-0.5">
              {MORE_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${
                    isActive(l) ? "bg-accent-soft text-accent-strong" : "text-foreground active:bg-surface-2"
                  }`}
                >
                  <l.icon className="size-5 text-muted" />
                  {l.label}
                </Link>
              ))}
            </nav>
            <div onClick={close}>{userMenu}</div>
          </div>
        </div>
      )}

      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur"
      >
        <div className="mx-auto grid h-15 max-w-xl grid-cols-5">
          {tab(HOME)}
          {tab(ITEMS, lowStockBadge)}
          <Link href="/items/new" onClick={close} aria-label="Thêm mặt hàng" className="grid place-items-center">
            <span className="grid size-11 place-items-center rounded-full bg-accent text-white shadow-md transition active:scale-90 dark:text-black">
              <Plus className="size-5.5" />
            </span>
          </Link>
          {tab(MOVEMENTS)}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Menu"
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition active:scale-95 ${
              open || moreActive ? "text-accent-strong" : "text-muted"
            }`}
          >
            <Menu className="size-5.5" />
            Menu
          </button>
        </div>
      </nav>
    </div>
  );
}
