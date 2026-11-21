import { Suspense } from "react";
import { FlaskConical } from "lucide-react";
import { devLoginEnabled, googleEnabled } from "@/lib/auth/constants";

export const metadata = { title: "Đăng nhập" };

const ERRORS: Record<string, string> = {
  OAUTH_CANCELLED: "Bạn đã huỷ đăng nhập Google.",
  OAUTH_STATE: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.",
  OAUTH_FAILED: "Không đăng nhập được bằng Google. Vui lòng thử lại.",
  OAUTH_EMAIL_UNVERIFIED: "Email Google của bạn chưa được xác minh.",
  GOOGLE_DISABLED: "Chưa cấu hình đăng nhập Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  DEV_EMAIL: "Email không hợp lệ.",
};

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-lg font-semibold">Đăng nhập</h1>
        <p className="mt-1 text-sm text-muted">Mỗi tài khoản Google có riêng kho linh kiện, tủ quần áo và tủ bếp</p>
      </div>
      <Suspense fallback={<GoogleButton next="/" />}>
        <LoginBody searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "Đăng nhập thất bại.") : null;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {googleEnabled() ? (
        <GoogleButton next={next} />
      ) : (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          Chưa cấu hình Google OAuth. Điền <code>GOOGLE_CLIENT_ID</code> và <code>GOOGLE_CLIENT_SECRET</code> trong{" "}
          <code>.env</code> rồi khởi động lại server.
        </p>
      )}
      {devLoginEnabled() && (
        <form action="/api/auth/dev-login" method="post" className="space-y-2 border-t border-dashed border-border pt-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <FlaskConical className="size-3.5" /> Đăng nhập thử (chỉ môi trường dev)
          </p>
          <div className="flex gap-2">
            <input name="email" type="email" required placeholder="email@vidu.com" className="input" />
            <button className="btn-secondary">Vào</button>
          </div>
        </form>
      )}
    </div>
  );
}

function GoogleButton({ next }: { next: string }) {
  return (
    <a
      href={`/api/auth/google?next=${encodeURIComponent(next)}`}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:bg-surface-2"
    >
      <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Đăng nhập bằng Google
    </a>
  );
}
