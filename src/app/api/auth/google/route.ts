import { type NextRequest, NextResponse, connection } from "next/server";
import { OAUTH_COOKIE, appBaseUrl, googleEnabled } from "@/lib/auth/constants";
import { start } from "@/lib/auth/google";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

/** Bắt đầu đăng nhập Google: lưu state + PKCE verifier vào cookie ngắn hạn rồi chuyển sang Google. */
export async function GET(req: NextRequest) {
  // Bắt buộc chạy theo từng request: state/verifier phải ngẫu nhiên cho mỗi lần đăng nhập
  await connection();
  if (!googleEnabled()) {
    return NextResponse.redirect(`${appBaseUrl()}/login?error=GOOGLE_DISABLED`);
  }
  const { url, state, verifier } = start();
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ s: state, v: verifier, n: safeNext(req.nextUrl.searchParams.get("next")) }), {
    httpOnly: true,
    sameSite: "lax", // cookie phải đi kèm khi Google chuyển hướng về (top-level GET)
    secure: process.env.COOKIE_SECURE === "true",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
