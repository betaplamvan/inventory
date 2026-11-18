import { connection } from "next/server";
import { CORS_HEADERS, protectedResourceMetadata } from "@/lib/auth/oauth";

/**
 * Protected Resource Metadata (RFC 9728) cho MCP server.
 * Phục vụ cả /.well-known/oauth-protected-resource và /.well-known/oauth-protected-resource/api/mcp.
 */
export async function GET() {
  await connection(); // đọc APP_BASE_URL lúc chạy, không prerender lúc build
  return Response.json(protectedResourceMetadata(), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
