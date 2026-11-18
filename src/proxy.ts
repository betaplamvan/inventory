import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PATHS, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/constants";

/**
 * Kiểm tra "lạc quan": chỉ xem có cookie phiên hay không (không truy vấn DB).
 * Việc xác thực thật nằm ở getCurrentUser()/requireUser() trong từng trang, action và API.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!token && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Gia hạn cookie (sliding) — DB tự gia hạn phiên tương ứng trong getCurrentUser()
  if (token && !isPublic) res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}

export const config = {
  // Bỏ qua file tĩnh, /api/media và /api/mcp: các route này tự xác thực (cookie / Bearer token),
  // và proxy chỉ buffer body tối đa 10MB rồi cắt ngang → hỏng upload video / ảnh base64 qua MCP.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/media|api/mcp).*)"],
};
