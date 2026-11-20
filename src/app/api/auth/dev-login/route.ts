import { type NextRequest, NextResponse } from "next/server";
import { appBaseUrl, devLoginEnabled } from "@/lib/auth/constants";
import { isValidEmail, normalizeEmail } from "@/lib/auth/crypto";
import { loginWithProfile } from "@/lib/auth/accounts";
import { createSession } from "@/lib/auth/session";

/**
 * Đăng nhập thử không qua Google — chỉ khi ALLOW_DEV_LOGIN=true
 * và không chạy production. Đi đúng luồng tạo/gộp tài khoản như Google với subject "dev:<email>".
 *   POST /api/auth/dev-login  (form: email)
 */
export async function POST(req: NextRequest) {
  if (!devLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const fd = await req.formData();
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  if (!isValidEmail(email)) return NextResponse.redirect(`${appBaseUrl()}/login?error=DEV_EMAIL`, 303);

  const userId = await loginWithProfile("dev", {
    sub: `dev:${email}`,
    email,
    name: email.split("@")[0],
    picture: null,
  });
  await createSession(userId);
  return NextResponse.redirect(`${appBaseUrl()}/`, 303);
}
