import { CORS_HEADERS, OAuthError, oauthErrorResponse, oauthJson, registerClient } from "@/lib/auth/oauth";

/** Dynamic Client Registration (RFC 7591): Claude, Claude Code, Cursor… tự đăng ký trước khi xin quyền. */
export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new OAuthError("invalid_client_metadata", "Body phải là JSON");
    }
    return oauthJson(await registerClient(body), 201);
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
