import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createConversation, getConversation } from "@/lib/chat/agent";
import { llmConfigured } from "@/lib/chat/llm";
import { RunBusyError, runStream, startRun } from "@/lib/chat/runs";

const bodySchema = z.object({
  conversationId: z.uuid().nullish(),
  message: z.string().max(8000).nullish(),
  decisions: z.record(z.string(), z.enum(["approve", "reject"])).optional(),
});

/**
 * Bắt đầu một lượt chat và theo dõi nó qua Server-Sent Events (mỗi sự kiện: `data: <ChatStreamEvent>`).
 * Lượt chat chạy nền (lib/chat/runs.ts): ngắt kết nối / chuyển trang không làm dừng câu trả lời;
 * nối lại qua GET /api/chat/conversations/[id]/stream, dừng qua POST /api/chat/stop.
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!llmConfigured()) return Response.json({ error: "Chưa cấu hình LLM (LLM_BASE_URL)" }, { status: 503 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  const { conversationId, decisions } = parsed.data;
  const message = parsed.data.message?.trim() || null;
  if (!message && !decisions) return Response.json({ error: "Tin nhắn trống" }, { status: 400 });

  let id: string;
  let created: { title: string } | undefined;
  if (conversationId) {
    const conv = await getConversation(me.id, conversationId);
    if (!conv) return Response.json({ error: "Không tìm thấy cuộc trò chuyện" }, { status: 404 });
    id = conv.id;
  } else {
    if (!message) return Response.json({ error: "Tin nhắn trống" }, { status: 400 });
    const conv = await createConversation(me.id, message);
    id = conv.id;
    created = { title: conv.title };
  }

  try {
    const run = await startRun({
      user: { id: me.id, name: me.name, email: me.email },
      conversationId: id,
      created,
      message,
      decisions,
    });
    return runStream(run);
  } catch (err) {
    if (err instanceof RunBusyError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
