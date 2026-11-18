import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { appBaseUrl } from "./constants";
import { normalizeEmail, randomToken } from "./crypto";

/**
 * Google OAuth 2.0 — Authorization Code + PKCE, xử lý hoàn toàn ở server (theo okia).
 *  1. start(): sinh state + code_verifier → URL chuyển hướng sang Google
 *  2. exchange(): đổi `code` lấy `id_token`, xác minh chữ ký bằng JWKS của Google
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export class OAuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export type GoogleProfile = { sub: string; email: string; name: string | null; picture: string | null };

export const redirectUri = () => `${appBaseUrl()}/api/auth/google/callback`;

export function start() {
  const state = randomToken();
  const verifier = randomToken() + randomToken(); // 86 ký tự (43–128 theo RFC 7636)
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${params}`, state, verifier };
}

export async function exchange(code: string, verifier: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("[google] đổi code thất bại:", res.status, await res.text().catch(() => ""));
    throw new OAuthError("OAUTH_FAILED");
  }
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new OAuthError("OAUTH_FAILED");
  return verifyIdToken(id_token);
}

async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, JWKS, {
      algorithms: ["RS256"],
      audience: process.env.GOOGLE_CLIENT_ID!,
      issuer: ISSUERS,
    }));
  } catch (err) {
    console.error("[google] id_token không hợp lệ:", (err as Error).message);
    throw new OAuthError("OAUTH_FAILED");
  }
  const email = typeof claims.email === "string" ? claims.email : "";
  if (!email || claims.email_verified !== true) throw new OAuthError("OAUTH_EMAIL_UNVERIFIED");
  return {
    sub: String(claims.sub),
    email: normalizeEmail(email),
    name: typeof claims.name === "string" ? claims.name.slice(0, 80) : null,
    picture: typeof claims.picture === "string" ? claims.picture.slice(0, 512) : null,
  };
}
