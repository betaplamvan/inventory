import { Suspense } from "react";
import Link from "next/link";
import { Heart, UserRound } from "lucide-react";
import { authorSupportEnabled } from "@/lib/author";
import { DeleteAccountForm, LogoutOthersForm } from "@/components/account-forms";
import { ApiTokensPanel } from "@/components/api-tokens-panel";
import { NotifyPanel } from "@/components/notify-panel";
import { ResetToursButton } from "@/components/tour";
import { getNotifyStatus } from "@/lib/notify/settings";
import { listApiTokens } from "@/lib/auth/api-tokens";
import { appBaseUrl } from "@/lib/auth/constants";
import { PageHeader, Skeleton } from "@/components/ui";
import { countSessions, requireUser } from "@/lib/auth/session";

export const metadata = { title: "Tài khoản" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Tài khoản" tour="account" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Account />
      </Suspense>
    </div>
  );
}

async function Account() {
  const me = await requireUser();
  const [sessions, tokens, notify] = await Promise.all([
    countSessions(me.id),
    listApiTokens(me.id),
    getNotifyStatus(me.id),
  ]);
  return (
    <div className="space-y-4">
      <section className="card flex items-center gap-4 p-4 sm:p-5">
        {me.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện Google
          <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-14 shrink-0 rounded-full" />
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <UserRound className="size-7" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{me.name || me.email}</p>
          <p className="truncate text-sm text-muted">{me.email}</p>
          <p className="mt-1 text-xs text-muted">Đăng nhập bằng Google · tên và ảnh đồng bộ từ tài khoản Google</p>
        </div>
      </section>

      <section className="card p-4 sm:p-5" data-tour="acc-notify">
        <h2 className="mb-3 text-sm font-semibold">Thông báo sắp hết hàng</h2>
        <NotifyPanel status={notify} email={me.email} />
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Phiên đăng nhập</h2>
        <LogoutOthersForm otherSessions={Math.max(0, sessions - 1)} />
      </section>

      <section className="card min-w-0 p-4 sm:p-5" data-tour="acc-tokens">
        <h2 className="mb-3 text-sm font-semibold">API token cho AI agent (MCP)</h2>
        <ApiTokensPanel tokens={tokens} mcpUrl={`${appBaseUrl()}/api/mcp`} />
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Hướng dẫn sử dụng</h2>
        <ResetToursButton />
      </section>

      <section className="card border-danger/30 p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-danger">Xoá tài khoản</h2>
        <DeleteAccountForm email={me.email} />
      </section>

      {authorSupportEnabled() && (
        <p className="pt-2 text-center text-xs text-muted">
          Kho linh kiện là phần mềm mã nguồn mở, miễn phí.{" "}
          <Link href="/support" className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
            <Heart className="size-3" /> Ủng hộ tác giả
          </Link>
        </p>
      )}
    </div>
  );
}
