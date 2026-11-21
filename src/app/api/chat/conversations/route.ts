import { getCurrentUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/chat/agent";
import { currentDomain } from "@/lib/domain-server";

/** Danh sách cuộc trò chuyện với trợ lý, mới nhất trước. */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  return Response.json({ conversations: await listConversations(me.id, await currentDomain()) }, { headers: { "Cache-Control": "no-store" } });
}
