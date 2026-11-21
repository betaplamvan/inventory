import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { runChat } from "@/lib/chat/agent";
import { llmConfigured } from "@/lib/chat/llm";
import type { ChatStreamEvent } from "@/lib/chat/types";

const bodySchema = z.object({
  conversationId: z.uuid().nullish(),
  message: z.string().max(8000).nullish(),
  decisions: z.record(z.string(), z.enum(["approve", "reject"])).optional(),
});

/**
 * Một lượt chat với trợ lý. Trả về Server-Sent Events (text/event-stream), mỗi sự kiện là
 * 1 dòng `data: <ChatStreamEvent JSON>`. Huỷ request (nút Dừng) → dừng gọi LLM.
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!llmConfigured()) return Response.json({ error: "Chưa cấu hình LLM (LLM_BASE_URL)" }, { status: 503 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  const { conversationId, message, decisions } = parsed.data;
  if (!message?.trim() && !decisions) return Response.json({ error: "Tin nhắn trống" }, { status: 400 });

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          abort.abort(); // client đã ngắt
        }
      };
      try {
        for await (const ev of runChat({
          user: { id: me.id, name: me.name, email: me.email },
          conversationId,
          message,
          decisions,
          signal: abort.signal,
        })) {
          send(ev);
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
