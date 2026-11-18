import { Suspense } from "react";
import { UserRound } from "lucide-react";
import { DeleteAccountForm, LogoutOthersForm } from "@/components/account-forms";
import { PageHeader, Skeleton } from "@/components/ui";
import { countSessions, requireUser } from "@/lib/auth/session";

export const metadata = { title: "Tài khoản" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Tài khoản" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Account />
      </Suspense>
    </div>
  );
}

async function Account() {
  const me = await requireUser();
  const sessions = await countSessions(me.id);
  return (
    <div className="space-y-4">
      <section className="card flex items-center gap-4 p-5">
        {me.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện Google
          <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-14 rounded-full" />
        ) : (
          <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <UserRound className="size-7" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{me.name || me.email}</p>
          <p className="truncate text-sm text-muted">{me.email}</p>
          <p className="mt-1 text-xs text-muted">Đăng nhập bằng Google · tên và ảnh đồng bộ từ tài khoản Google</p>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold">Phiên đăng nhập</h2>
        <LogoutOthersForm otherSessions={Math.max(0, sessions - 1)} />
      </section>

      <section className="card border-danger/30 p-5">
        <h2 className="mb-3 text-sm font-semibold text-danger">Xoá tài khoản</h2>
        <DeleteAccountForm email={me.email} />
      </section>
    </div>
  );
}
