import { type NextRequest, NextResponse } from "next/server";
import { OAUTH_COOKIE, appBaseUrl } from "@/lib/auth/constants";
import { loginWithProfile } from "@/lib/auth/accounts";
import { OAuthError, exchange } from "@/lib/auth/google";
import { createSession } from "@/lib/auth/session";

/** Google chuyển hướng về đây với ?code=…&state=… */
export async function GET(req: NextRequest) {
  const base = appBaseUrl();
  const fail = (code: string) => {
    const res = NextResponse.redirect(`${base}/login?error=${code}`, 303);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    return res;
  };

  const sp = req.nextUrl.searchParams;
  let saved: { s: string; v: string; n: string } | null = null;
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_COOKIE)?.value ?? "null");
  } catch {}

  // state phải khớp cookie → chống CSRF / login injection
  if (!saved?.s || !saved.v || sp.get("state") !== saved.s) return fail("OAUTH_STATE");
  if (sp.get("error") || !sp.get("code")) return fail("OAUTH_CANCELLED");

  try {
    const profile = await exchange(sp.get("code")!, saved.v);
    const userId = await loginWithProfile("google", profile);
    await createSession(userId);
  } catch (err) {
    if (err instanceof OAuthError) return fail(err.code);
    console.error("[google] lỗi đăng nhập:", err);
    return fail("OAUTH_FAILED");
  }

  const next = saved.n?.startsWith("/") && !saved.n.startsWith("//") ? saved.n : "/";
  const res = NextResponse.redirect(`${base}${next}`, 303);
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  return res;
}
