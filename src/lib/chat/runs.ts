import "server-only";
import { after } from "next/server";
import { autoTitle, lastMessageId, runChat } from "./agent";
import type { ChatDecision, ChatStreamEvent, UiMessage } from "./types";

/**
 * Lượt chat chạy nền, tách khỏi kết nối của trình duyệt: chuyển trang, đóng khung chat, tắt màn hình
 * điện thoại… không làm dừng câu trả lời. Chỉ dừng khi người dùng bấm Dừng (stopRun) hoặc quá giờ.
 *
 * Mỗi lượt giữ toàn bộ sự kiện đã phát → trình duyệt nối lại (attach) bất cứ lúc nào: nhận "trạng thái nền"
 * (tin nhắn trước lượt này, từ DB) rồi phát lại các sự kiện từ đầu lượt và tiếp tục theo dõi.
 * Lưu trong bộ nhớ tiến trình — app chạy 1 container nên đủ dùng.
 */

const MAX_RUN_MS = 10 * 60_000;
/** Giữ lượt đã xong thêm một lúc cho client nối vào đúng lúc vừa kết thúc */
const KEEP_DONE_MS = 30_000;

type Listener = { onEvent: (ev: ChatStreamEvent) => void; onEnd: () => void };

export type Run = {
  conversationId: string;
  userId: string;
  /** id tin nhắn cuối cùng trước khi lượt này bắt đầu */
  baseRowId: number;
  events: ChatStreamEvent[];
  listeners: Set<Listener>;
  done: boolean;
  /** Đã trả lời xong (sự kiện "done"), chỉ còn việc phụ như đặt tiêu đề → không chặn tin nhắn tiếp theo */
  answered: boolean;
  abort: AbortController;
};

const g = globalThis as unknown as { __invChatRuns?: Map<string, Run> };
const runs = (g.__invChatRuns ??= new Map<string, Run>());

export class RunBusyError extends Error {}

/** Lượt đang chạy (chưa xong) của cuộc trò chuyện, nếu có và thuộc user này */
export function activeRun(conversationId: string, userId: string) {
  const run = runs.get(conversationId);
  return run && run.userId === userId && !run.done ? run : null;
}

function emit(run: Run, ev: ChatStreamEvent) {
  if (ev.type === "done") run.answered = true;
  run.events.push(ev);
  for (const l of run.listeners) l.onEvent(ev);
}

export async function startRun(opts: {
  user: { id: string; name: string | null; email: string };
  conversationId: string;
  /** Cuộc trò chuyện vừa tạo → phát sự kiện "conversation" đầu tiên */
  created?: { title: string };
  message?: string | null;
  decisions?: Record<string, ChatDecision>;
}): Promise<Run> {
  const { conversationId, user } = opts;
  const busy = () => {
    const cur = activeRun(conversationId, user.id);
    return !!cur && !cur.answered;
  };
  if (busy()) throw new RunBusyError("Trợ lý đang trả lời cuộc trò chuyện này");

  const run: Run = {
    conversationId,
    userId: user.id,
    baseRowId: await lastMessageId(conversationId),
    events: [],
    listeners: new Set(),
    done: false,
    answered: false,
    abort: new AbortController(),
  };
  // Kiểm tra lại sau await: 2 request gần như cùng lúc
  if (busy()) throw new RunBusyError("Trợ lý đang trả lời cuộc trò chuyện này");
  runs.set(conversationId, run);
  if (opts.created) emit(run, { type: "conversation", id: conversationId, title: opts.created.title });

  const timeout = setTimeout(() => run.abort.abort(), MAX_RUN_MS);
  const task = (async () => {
    let finished = false;
    try {
      for await (const ev of runChat({
        user,
        conversationId,
        message: opts.message,
        decisions: opts.decisions,
        signal: run.abort.signal,
      })) {
        if (ev.type === "done") finished = true;
        emit(run, ev);
      }
      // Cuộc trò chuyện mới: trả lời xong câu đầu → tự đặt tiêu đề (thay cho câu hỏi đầu)
      if (opts.created && finished && !run.abort.signal.aborted) {
        const title = await autoTitle(conversationId, run.abort.signal).catch((err) => {
          console.warn("[chat] không đặt được tiêu đề:", (err as Error).message);
          return null;
        });
        if (title) emit(run, { type: "title", id: conversationId, title });
      }
    } catch (err) {
      console.error("[chat] lượt chạy lỗi", err);
      emit(run, { type: "error", message: "Có lỗi khi xử lý, vui lòng thử lại" });
    } finally {
      clearTimeout(timeout);
      // Bị dừng giữa chừng → vẫn kết thúc gọn cho client
      if (!finished) emit(run, { type: "done", awaiting: false });
      run.done = true;
      for (const l of run.listeners) l.onEnd();
      run.listeners.clear();
      setTimeout(() => {
        if (runs.get(conversationId) === run) runs.delete(conversationId);
      }, KEEP_DONE_MS);
    }
  })();
  // Giữ ngữ cảnh request (revalidatePath của tool ghi…) tới khi lượt chạy xong, kể cả khi client đã ngắt
  after(task);
  return run;
}

/** Bấm Dừng */
export function stopRun(conversationId: string, userId: string) {
  activeRun(conversationId, userId)?.abort.abort();
}

/**
 * Stream SSE theo dõi một lượt: (snapshot) → phát lại sự kiện từ đầu lượt → sự kiện mới → đóng khi xong.
 * Client ngắt kết nối chỉ huỷ theo dõi, KHÔNG dừng lượt chạy.
 */
export function runStream(run: Run, snapshot?: UiMessage[]) {
  const encoder = new TextEncoder();
  let listener: Listener | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          end();
        }
      };
      const end = () => {
        if (closed) return;
        closed = true;
        if (listener) run.listeners.delete(listener);
        try {
          controller.close();
        } catch {}
      };

      if (snapshot) send({ type: "snapshot", messages: snapshot });
      // Phát lại + đăng ký trong cùng một nhịp (đồng bộ) → không sót, không trùng sự kiện
      for (const ev of run.events) send(ev);
      if (run.done) return end();
      listener = { onEvent: send, onEnd: end };
      run.listeners.add(listener);
    },
    cancel() {
      if (listener) run.listeners.delete(listener);
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
