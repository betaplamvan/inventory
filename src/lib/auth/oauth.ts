import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, lte, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiTokens, oauthClients, oauthCodes } from "@/db/schema";
import { TOKEN_PREFIX, type TokenScope } from "./api-tokens";
import { appBaseUrl } from "./constants";
import { randomToken, sha256 } from "./crypto";

/**
 * Máy chủ uỷ quyền OAuth 2.1 tối giản cho MCP (theo đặc tả MCP Authorization):
 *  - metadata: /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
 *  - đăng ký client động (RFC 7591): POST /api/oauth/register
 *  - uỷ quyền: /oauth/authorize (trang đồng ý, dùng đăng nhập Google sẵn có), bắt buộc PKCE S256
 *  - token: POST /api/oauth/token (authorization_code, refresh_token)
 * Access token là token inv_… bình thường trong bảng api_tokens → /api/mcp và upload không cần đổi.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;
const CODE_TTL_MINUTES = 10;
const REFRESH_PREFIX = "invr_";

export const SCOPES: TokenScope[] = ["read", "write"];

export const issuer = () => appBaseUrl();
export const mcpResource = () => `${appBaseUrl()}/api/mcp`;
export const resourceMetadataUrl = () => `${appBaseUrl()}/.well-known/oauth-protected-resource/api/mcp`;

export class OAuthError extends Error {
  constructor(
    public code: string,
    description: string,
    public status = 400,
  ) {
    super(description);
  }
}

/** Header CORS cho endpoint OAuth công khai (không dùng cookie) — client chạy trên trình duyệt cũng gọi được */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function oauthJson(data: unknown, status = 200, extra?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });
}

export function oauthErrorResponse(err: unknown) {
  if (err instanceof OAuthError) {
    return oauthJson(
      { error: err.code, error_description: err.message },
      err.status,
      err.status === 401 ? { "WWW-Authenticate": 'Basic realm="inventory"' } : undefined,
    );
  }
  console.error("[oauth]", err);
  return oauthJson({ error: "server_error", error_description: "Có lỗi xảy ra" }, 500);
}

export function authorizationServerMetadata() {
  const base = appBaseUrl();
  return {
    issuer: issuer(),
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/account`,
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Kho đồ",
  };
}

/* ------------------------------------------------------------------ */
/* Đăng ký client (RFC 7591)                                           */
/* ------------------------------------------------------------------ */

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopback(u: URL) {
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

/** https, http loopback (ứng dụng chạy trên máy) hoặc custom scheme của app native (cursor://…) */
function checkRedirectUri(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (BLOCKED_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === "http:") return isLoopback(u);
  return true;
}

const registerSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(100).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(200).optional(),
});

export async function registerClient(body: unknown) {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthError(
      "invalid_client_metadata",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  const meta = parsed.data;
  const bad = meta.redirect_uris.find((u) => !checkRedirectUri(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `redirect_uri không được phép: ${bad}`);
  if (meta.grant_types && !meta.grant_types.includes("authorization_code")) {
    throw new OAuthError("invalid_client_metadata", "grant_types phải có authorization_code");
  }
  if (meta.response_types && meta.response_types.some((r) => r !== "code")) {
    throw new OAuthError("invalid_client_metadata", "Chỉ hỗ trợ response_type code");
  }

  // Dọn client đăng ký quá 7 ngày mà chưa từng được uỷ quyền (endpoint đăng ký là công khai)
  await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, sql`now() - interval '7 days'`),
        notExists(db.select({ x: sql`1` }).from(apiTokens).where(eq(apiTokens.oauthClientId, oauthClients.id))),
      ),
    );

  // Mặc định của RFC 7591 là client_secret_basic
  const method = meta.token_endpoint_auth_method ?? "client_secret_basic";
  const clientId = "mcp_" + randomToken().slice(0, 32);
  const clientSecret = method === "none" ? null : "mcps_" + randomToken();
  const name = (meta.client_name?.trim() || "Ứng dụng MCP").slice(0, 100);

  const [row] = await db
    .insert(oauthClients)
    .values({
      id: clientId,
      clientSecretHash: clientSecret ? sha256(clientSecret) : null,
      tokenEndpointAuthMethod: method,
      name,
      redirectUris: meta.redirect_uris,
    })
    .returning({ createdAt: oauthClients.createdAt });

  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    client_name: name,
    redirect_uris: meta.redirect_uris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

export async function getClient(clientId: string | null | undefined) {
  if (!clientId || clientId.length > 100) return null;
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  return row ?? null;
}

/** So khớp chính xác; riêng loopback cho phép khác cổng (RFC 8252 §7.3) */
export function redirectUriAllowed(client: { redirectUris: string[] }, uri: string | null | undefined) {
  if (!uri) return false;
  if (client.redirectUris.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  return client.redirectUris.some((r) => {
    try {
      const reg = new URL(r);
      return isLoopback(reg) && reg.hostname === u.hostname && reg.pathname === u.pathname && reg.search === u.search;
    } catch {
      return false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Uỷ quyền                                                            */
/* ------------------------------------------------------------------ */

/** Quyền mặc định gợi ý trên trang đồng ý: chỉ đọc nếu client chỉ xin "read" */
export function requestedScope(scope: string | null | undefined): TokenScope {
  const parts = (scope ?? "").split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.includes("read") && !parts.includes("write") ? "read" : "write";
}

/** resource (RFC 8707) nếu có phải trỏ tới MCP server này */
export function resourceAllowed(resource: string | null | undefined) {
  if (!resource) return true;
  const norm = (s: string) => s.replace(/\/+$/, "");
  return [mcpResource(), issuer()].map(norm).includes(norm(resource));
}

export async function createAuthCode(opts: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: TokenScope;
}) {
  await db.delete(oauthCodes).where(lte(oauthCodes.expiresAt, sql`now()`));
  const code = randomToken();
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId: opts.clientId,
    userId: opts.userId,
    redirectUri: opts.redirectUri,
    codeChallenge: opts.codeChallenge,
    scope: opts.scope,
    expiresAt: sql`now() + ${`${CODE_TTL_MINUTES} minutes`}::interval`,
  });
  return code;
}

export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

/* ------------------------------------------------------------------ */
/* Token endpoint                                                      */
/* ------------------------------------------------------------------ */

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Xác thực client: Basic header hoặc client_id/client_secret trong body; public client chỉ cần client_id */
export async function authenticateClient(params: URLSearchParams, authorization: string | null) {
  let clientId = params.get("client_id");
  let secret = params.get("client_secret");
  const basic = authorization?.match(/^Basic\s+(\S+)$/i);
  if (basic) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) throw new OAuthError("invalid_client", "Header Basic không hợp lệ", 401);
    clientId = decodeURIComponent(decoded.slice(0, i));
    secret = decodeURIComponent(decoded.slice(i + 1));
  }
  const client = await getClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "Client không tồn tại — hãy đăng ký lại", 401);
  if (client.clientSecretHash) {
    if (!secret || !safeEqual(sha256(secret), client.clientSecretHash)) {
      throw new OAuthError("invalid_client", "Sai client_secret", 401);
    }
  }
  return client;
}

function pkceOk(verifier: string | null, challenge: string) {
  if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return safeEqual(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

function newTokenPair() {
  const access = TOKEN_PREFIX + randomToken();
  const refresh = REFRESH_PREFIX + randomToken();
  return {
    access,
    refresh,
    columns: {
      tokenHash: sha256(access),
      prefix: access.slice(0, TOKEN_PREFIX.length + 6),
      refreshTokenHash: sha256(refresh),
      expiresAt: sql`now() + ${`${ACCESS_TOKEN_TTL_SECONDS} seconds`}::interval`,
      refreshExpiresAt: sql`now() + ${`${REFRESH_TOKEN_TTL_DAYS} days`}::interval`,
    },
  };
}

function tokenResponse(pair: { access: string; refresh: string }, scope: TokenScope) {
  return {
    access_token: pair.access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: pair.refresh,
    scope,
  };
}

export async function exchangeAuthorizationCode(params: URLSearchParams, authorization: string | null) {
  const client = await authenticateClient(params, authorization);
  const code = params.get("code");
  if (!code) throw new OAuthError("invalid_request", "Thiếu code");
  if (!resourceAllowed(params.get("resource"))) throw new OAuthError("invalid_target", "resource không hợp lệ");

  // Xoá ngay khi đọc (không bọc transaction) → code bị tiêu kể cả khi kiểm tra bên dưới thất bại:
  // mỗi code chỉ có đúng 1 lần thử
  const [row] = await db
    .delete(oauthCodes)
    .where(and(eq(oauthCodes.codeHash, sha256(code)), gt(oauthCodes.expiresAt, sql`now()`)))
    .returning();
  if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Code không hợp lệ hoặc đã hết hạn");
  if (params.get("redirect_uri") !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri không khớp");
  if (!pkceOk(params.get("code_verifier"), row.codeChallenge)) throw new OAuthError("invalid_grant", "code_verifier sai");

  // Dọn các kết nối OAuth đã hết hạn refresh của user này
  await db.delete(apiTokens).where(and(eq(apiTokens.userId, row.userId), lte(apiTokens.refreshExpiresAt, sql`now()`)));

  const pair = newTokenPair();
  await db.insert(apiTokens).values({
    userId: row.userId,
    name: client.name,
    scope: row.scope,
    oauthClientId: client.id,
    ...pair.columns,
  });
  return tokenResponse(pair, row.scope);
}

export async function refreshAccessToken(params: URLSearchParams, authorization: string | null) {
  const client = await authenticateClient(params, authorization);
  const refresh = params.get("refresh_token");
  if (!refresh?.startsWith(REFRESH_PREFIX)) throw new OAuthError("invalid_grant", "refresh_token không hợp lệ");

  const pair = newTokenPair();
  // Xoay vòng nguyên tử: refresh token cũ mất hiệu lực ngay
  const [row] = await db
    .update(apiTokens)
    .set(pair.columns)
    .where(
      and(
        eq(apiTokens.refreshTokenHash, sha256(refresh)),
        eq(apiTokens.oauthClientId, client.id),
        gt(apiTokens.refreshExpiresAt, sql`now()`),
      ),
    )
    .returning({ scope: apiTokens.scope });
  if (!row) throw new OAuthError("invalid_grant", "refresh_token không hợp lệ, đã hết hạn hoặc đã bị thu hồi");

  // Cho phép xin bớt quyền (write → read), không cho xin thêm
  let scope = row.scope as TokenScope;
  if (scope === "write" && requestedScope(params.get("scope")) === "read" && params.get("scope")) {
    scope = "read";
    await db.update(apiTokens).set({ scope }).where(eq(apiTokens.tokenHash, pair.columns.tokenHash));
  }
  return tokenResponse(pair, scope);
}
