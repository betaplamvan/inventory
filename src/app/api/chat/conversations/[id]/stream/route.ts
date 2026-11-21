import { getCurrentUser } from "@/lib/auth/session";
import { conversationForUi } from "@/lib/chat/agent";
import { activeRun, runStream } from "@/lib/chat/runs";

/**
 * Nối vào lượt chat đang chạy (sau khi chuyển trang, tải lại, mở trên thiết bị khác…).
 * Trả SSE: snapshot (tin nhắn trước lượt này) → các sự kiện từ đầu lượt → sự kiện mới.
 * 204 nếu không có lượt nào đang chạy (client tải lịch sử bình thường).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/chat/conversations/[id]/stream">) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await ctx.params;
  const run = activeRun(id, me.id);
  if (!run) return new Response(null, { status: 204 });
  const snapshot = await conversationForUi(me.id, id, run.baseRowId);
  return runStream(run, snapshot);
}
