/** Dùng được cả trong proxy (không import DB). */
export const SESSION_COOKIE = "inv_session";
export const OAUTH_COOKIE = "inv_oauth";
export const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** Đường dẫn không cần đăng nhập */
export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health"];

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Đăng nhập thử không qua Google — chỉ khi bật ALLOW_DEV_LOGIN và không phải production (như okia). */
export const devLoginEnabled = () =>
  process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

export function appBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}
