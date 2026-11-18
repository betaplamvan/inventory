import { connection } from "next/server";
import { CORS_HEADERS, authorizationServerMetadata } from "@/lib/auth/oauth";

/** Authorization Server Metadata (RFC 8414). */
export async function GET() {
  await connection(); // đọc APP_BASE_URL lúc chạy, không prerender lúc build
  return Response.json(authorizationServerMetadata(), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
