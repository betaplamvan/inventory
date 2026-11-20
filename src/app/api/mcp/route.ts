import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyBearer } from "@/lib/auth/api-tokens";
import { runAsUser } from "@/lib/auth/actor";
import { SCOPES, resourceMetadataUrl } from "@/lib/auth/oauth";
import { buildMcpServer } from "@/lib/mcp/server";

/**
 * MCP server (Streamable HTTP, stateless) cho agent đọc / ghi kho.
 *   URL:  <APP_BASE_URL>/api/mcp
 *   Auth: Authorization: Bearer inv_…  — tạo ở trang Tài khoản → API token,
 *         hoặc client tự xin qua OAuth (Claude web / điện thoại: chỉ cần dán URL)
 * Mỗi request tạo server + transport mới; dữ liệu luôn lọc theo chủ token.
 */
export async function POST(req: Request) {
  const authorization = req.headers.get("authorization");
  const auth = await verifyBearer(authorization);
  if (!auth) {
    // resource_metadata → client OAuth (Claude web / điện thoại…) tự tìm ra máy chủ uỷ quyền;
    // invalid_token → client biết cần refresh / xin quyền lại
    const challenge = [
      'Bearer realm="inventory"',
      `resource_metadata="${resourceMetadataUrl()}"`,
      `scope="${SCOPES.join(" ")}"`,
      ...(authorization ? ['error="invalid_token"'] : []),
    ].join(", ");
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Thiếu hoặc sai API token (Authorization: Bearer inv_…)" },
        id: null,
      },
      { status: 401, headers: { "WWW-Authenticate": challenge } },
    );
  }

  const server = buildMcpServer({ userId: auth.userId, scope: auth.scope, tokenId: auth.tokenId, tokenName: auth.name });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await runAsUser(
      auth.userId,
      () =>
        transport.handleRequest(req, {
          authInfo: { token: auth.tokenId, clientId: auth.tokenId, scopes: [auth.scope], extra: { userId: auth.userId } },
        }),
      { source: "agent", name: auth.name },
    );
  } finally {
    // Response JSON đã được tạo xong (enableJsonResponse) → đóng server của request này
    void server.close();
  }
}

/** Chế độ stateless: không có SSE stream (GET) hay phiên (DELETE). */
function methodNotAllowed() {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
