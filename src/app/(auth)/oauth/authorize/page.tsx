import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CircleAlert, KeyRound, Loader2 } from "lucide-react";
import { approveOAuth, denyOAuth } from "@/actions/oauth";
import { SubmitButton } from "@/components/confirm-button";
import {
  buildRedirect,
  getClient,
  issuer,
  redirectUriAllowed,
  requestedScope,
  resourceAllowed,
} from "@/lib/auth/oauth";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = { title: "Cho phép truy cập kho" };

/**
 * Authorization endpoint của OAuth (GET /oauth/authorize?response_type=code&client_id=…).
 * Chưa đăng nhập → qua đăng nhập Google rồi quay lại đây; đã đăng nhập → trang đồng ý.
 */
export default function AuthorizePage(props: PageProps<"/oauth/authorize">) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Đang tải…
        </p>
      }
    >
      <Consent searchParams={props.searchParams} />
    </Suspense>
  );
}

const PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

async function Consent({ searchParams }: { searchParams: PageProps<"/oauth/authorize">["searchParams"] }) {
  const sp = await searchParams;
  const p = Object.fromEntries(PARAMS.map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string) : null])) as Record<
    (typeof PARAMS)[number],
    string | null
  >;

  // Client / redirect_uri sai → báo lỗi tại chỗ, KHÔNG chuyển hướng (tránh open redirect)
  const client = await getClient(p.client_id);
  if (!client) {
    return <Problem>Ứng dụng chưa đăng ký hoặc đã bị xoá (client_id không hợp lệ). Hãy thử kết nối lại từ ứng dụng.</Problem>;
  }
  if (!p.redirect_uri || !redirectUriAllowed(client, p.redirect_uri)) {
    return <Problem>redirect_uri không khớp với địa chỉ ứng dụng đã đăng ký.</Problem>;
  }

  const back = (error: string, description: string): never =>
    redirect(buildRedirect(p.redirect_uri!, { error, error_description: description, state: p.state, iss: issuer() }));
  if (p.response_type !== "code") back("unsupported_response_type", "Chỉ hỗ trợ response_type=code");
  if (!p.code_challenge || p.code_challenge_method !== "S256") back("invalid_request", "Bắt buộc PKCE với code_challenge_method=S256");
  if (!resourceAllowed(p.resource)) back("invalid_target", "resource không phải MCP server này");

  const me = await getCurrentUser();
  if (!me) {
    const query = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => e[1] != null));
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  const redirectHost = (() => {
    const u = new URL(p.redirect_uri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : u.protocol.replace(/:$/, "");
  })();
  const defaultScope = requestedScope(p.scope);

  return (
    <form action={approveOAuth} className="space-y-4">
      <div className="text-center">
        <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-accent-soft text-accent-strong">
          <KeyRound className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">Kết nối {client.name}</h1>
        <p className="mt-1 text-sm text-muted">
          <b className="text-foreground">{client.name}</b> muốn truy cập Kho đồ (linh kiện, quần áo, thực phẩm) của{" "}
          <b className="text-foreground">{me.email}</b> qua MCP.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Quyền cấp cho ứng dụng</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm has-checked:border-accent has-checked:bg-accent-soft/40">
          <input type="radio" name="scope" value="write" defaultChecked={defaultScope === "write"} className="mt-0.5" />
          <span>
            <b>Đọc + ghi</b>
            <span className="block text-xs text-muted">Xem, thêm, sửa đồ trong cả 3 kho; nhập / xuất; danh sách cần mua; gắn ảnh; chuyển vào thùng rác (khôi phục được).</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm has-checked:border-accent has-checked:bg-accent-soft/40">
          <input type="radio" name="scope" value="read" defaultChecked={defaultScope === "read"} className="mt-0.5" />
          <span>
            <b>Chỉ đọc</b>
            <span className="block text-xs text-muted">Chỉ xem dữ liệu của cả 3 kho.</span>
          </span>
        </label>
      </fieldset>

      <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        Sau khi cho phép sẽ quay về <b className="text-foreground">{redirectHost}</b>. Chỉ cho phép nếu bạn vừa bấm kết nối từ
        ứng dụng này. Thu hồi bất cứ lúc nào ở trang Tài khoản.
      </p>

      <input type="hidden" name="client_id" value={client.id} />
      <input type="hidden" name="redirect_uri" value={p.redirect_uri} />
      <input type="hidden" name="code_challenge" value={p.code_challenge!} />
      {p.state != null && <input type="hidden" name="state" value={p.state} />}

      <div className="flex gap-2">
        <button formAction={denyOAuth} className="btn-secondary flex-1 justify-center">
          Từ chối
        </button>
        <SubmitButton className="btn-primary flex-1 justify-center">Cho phép</SubmitButton>
      </div>
    </form>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 text-center">
      <span className="mx-auto grid size-10 place-items-center rounded-full bg-danger/10 text-danger">
        <CircleAlert className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">Không thể kết nối</h1>
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}
