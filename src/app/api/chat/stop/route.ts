import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { stopRun } from "@/lib/chat/runs";

/** Nút Dừng: huỷ lượt chat đang chạy (phần đã trả lời được giữ lại). */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  stopRun(parsed.data.conversationId, me.id);
  return new Response(null, { status: 204 });
}
