import { Suspense } from "react";
import { AppNav, MobileNav } from "@/components/app-nav";
import { LowStockBadge } from "@/components/low-stock-badge";
import { UserMenu } from "@/components/user-menu";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const badge = (
    <Suspense fallback={null}>
      <LowStockBadge />
    </Suspense>
  );
  const userMenu = (
    <Suspense fallback={null}>
      <UserMenu />
    </Suspense>
  );
  return (
    <div className="flex min-h-dvh pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface lg:block print:hidden">
        <AppNav lowStockBadge={badge} userMenu={userMenu} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav lowStockBadge={badge} userMenu={userMenu} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-4 pb-[calc(var(--tabbar)+1.5rem)] sm:px-6 lg:pt-8 lg:pb-8 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
