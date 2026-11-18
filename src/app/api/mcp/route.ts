import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyBearer } from "@/lib/auth/api-tokens";
import { runAsUser } from "@/lib/auth/actor";
import { buildMcpServer } from "@/lib/mcp/server";

/**
 * MCP server (Streamable HTTP, stateless) cho agent đọc / ghi kho.
 *   URL:  <APP_BASE_URL>/api/mcp
 *   Auth: Authorization: Bearer inv_…  (tạo ở trang Tài khoản → API token)
 * Mỗi request tạo server + transport mới; dữ liệu luôn lọc theo chủ token.
 */
export async function POST(req: Request) {
  const auth = await verifyBearer(req.headers.get("authorization"));
  if (!auth) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Thiếu hoặc sai API token (Authorization: Bearer inv_…)" },
        id: null,
      },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="inventory"' } },
    );
  }

  const server = buildMcpServer({ userId: auth.userId, scope: auth.scope, tokenId: auth.tokenId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await runAsUser(auth.userId, () =>
      transport.handleRequest(req, {
        authInfo: { token: auth.tokenId, clientId: auth.tokenId, scopes: [auth.scope], extra: { userId: auth.userId } },
      }),
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
