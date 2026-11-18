import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { logout } from "@/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="space-y-1 border-t border-border pt-3">
      <Link
        href="/account"
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
        title="Tài khoản"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện Google
          <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-full" />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <UserRound className="size-4" />
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium">{user.name || user.email.split("@")[0]}</span>
          <span className="block truncate text-xs text-muted">{user.email}</span>
        </span>
      </Link>
      <form action={logout}>
        <button className="btn-ghost w-full justify-start">
          <LogOut className="size-4" /> Đăng xuất
        </button>
      </form>
    </div>
  );
}
