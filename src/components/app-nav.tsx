"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Boxes,
  Cpu,
  FolderTree,
  LayoutDashboard,
  MapPin,
  Menu,
  Plus,
  X,
} from "lucide-react";

const LINKS = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard, exact: true },
  { href: "/items", label: "Kho hàng", icon: Boxes },
  { href: "/movements", label: "Nhập / Xuất", icon: ArrowLeftRight },
  { href: "/categories", label: "Danh mục", icon: FolderTree },
  { href: "/locations", label: "Vị trí cất", icon: MapPin },
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

export function MobileNav({ lowStockBadge, userMenu }: { lowStockBadge: ReactNode; userMenu: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <Brand />
        <div className="flex items-center gap-1">
          <Link href="/items/new" onClick={() => setOpen(false)} className="btn-primary btn-sm" aria-label="Thêm mặt hàng">
            <Plus className="size-4" />
          </Link>
          <button className="btn-ghost" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          <NavLinks lowStockBadge={lowStockBadge} onNavigate={() => setOpen(false)} />
          <div onClick={() => setOpen(false)}>{userMenu}</div>
        </div>
      )}
    </header>
  );
}
