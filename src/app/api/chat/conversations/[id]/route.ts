import { getCurrentUser } from "@/lib/auth/session";
import { conversationForUi, deleteConversation, getConversation } from "@/lib/chat/agent";
import { activeRun, stopRun } from "@/lib/chat/runs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tin nhắn của 1 cuộc trò chuyện (đã dựng sẵn cho giao diện).
 * running = đang có lượt trả lời chạy nền → client nối vào bằng /stream để xem tiếp.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;
  const conv = UUID.test(id) ? await getConversation(me.id, id) : null;
  if (!conv) return Response.json({ error: "Không tìm thấy cuộc trò chuyện" }, { status: 404 });
  return Response.json(
    {
      id: conv.id,
      title: conv.title,
      messages: await conversationForUi(me.id, conv.id),
      running: !!activeRun(conv.id, me.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 204 });
  stopRun(id, me.id);
  await deleteConversation(me.id, id);
  return new Response(null, { status: 204 });
}
