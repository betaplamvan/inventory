import { getCurrentUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/chat/agent";

/** Danh sách cuộc trò chuyện với trợ lý, mới nhất trước. */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  return Response.json({ conversations: await listConversations(me.id) }, { headers: { "Cache-Control": "no-store" } });
}
