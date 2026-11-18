import {
  CORS_HEADERS,
  OAuthError,
  exchangeAuthorizationCode,
  oauthErrorResponse,
  oauthJson,
  refreshAccessToken,
} from "@/lib/auth/oauth";

/** Token endpoint: đổi authorization code (kèm PKCE) hoặc refresh token lấy access token. */
export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    let params: URLSearchParams;
    if (type.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") throw new OAuthError("invalid_request", "Body JSON không hợp lệ");
      params = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
    } else {
      params = new URLSearchParams(await req.text());
    }
    const authorization = req.headers.get("authorization");

    switch (params.get("grant_type")) {
      case "authorization_code":
        return oauthJson(await exchangeAuthorizationCode(params, authorization));
      case "refresh_token":
        return oauthJson(await refreshAccessToken(params, authorization));
      default:
        throw new OAuthError("unsupported_grant_type", "Chỉ hỗ trợ authorization_code và refresh_token");
    }
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
