import "server-only";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chatConversations,
  chatMessages,
  items,
  type ChatMessage,
  type ChatToolCall,
  type ChatToolStatus,
} from "@/db/schema";
import { TRASH_DAYS } from "@/lib/inventory/trash";
import { DOMAIN_CONFIG, type Domain } from "@/lib/domains";
import { LlmError, streamChat, type LlmMessage } from "./llm";
import { openToolset, toolCatalog, type ToolMeta } from "./tools";
import type { ChatDecision, ChatStreamEvent, ConversationSummary, UiMessage, UiToolCall } from "./types";

/** Số bước gọi LLM tối đa cho 1 lượt (mỗi bước có thể gọi nhiều tool) */
const MAX_STEPS = 8;
/** Số tin nhắn gần nhất gửi lại cho model */
const MAX_HISTORY = 60;

/* ------------------------------------------------------------------ */
/* Lưu trữ hội thoại                                                   */
/* ------------------------------------------------------------------ */

/** Cuộc trò chuyện của một kho (trang /chat hiện theo kho đang chọn) */
export async function listConversations(userId: string, domain?: Domain, limit = 50): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(and(eq(chatConversations.userId, userId), domain ? eq(chatConversations.domain, domain) : undefined))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function getConversation(userId: string, id: string) {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)));
  return conv ?? null;
}

export async function deleteConversation(userId: string, id: string) {
  await db.delete(chatConversations).where(and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)));
}

async function loadMessages(conversationId: string, upToId?: number) {
  return db
    .select()
    .from(chatMessages)
    .where(
      upToId === undefined
        ? eq(chatMessages.conversationId, conversationId)
        : and(eq(chatMessages.conversationId, conversationId), lte(chatMessages.id, upToId)),
    )
    .orderBy(asc(chatMessages.id));
}

/** id tin nhắn lớn nhất hiện có (0 nếu chưa có) — mốc "trạng thái nền" của một lượt chạy */
export async function lastMessageId(conversationId: string) {
  const [r] = await db
    .select({ id: sql<number | null>`max(${chatMessages.id})` })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));
  return Number(r?.id ?? 0);
}

export async function createConversation(userId: string, firstMessage: string, domain: Domain) {
  const [conv] = await db
    .insert(chatConversations)
    .values({ userId, domain, title: titleFrom(firstMessage) })
    .returning();
  return conv;
}

/**
 * Dựng lại tin nhắn cho giao diện: gộp các bước liên tiếp của trợ lý thành 1 bong bóng.
 * upToId: chỉ lấy tới tin nhắn này — trạng thái trước khi lượt đang chạy bắt đầu (lib/chat/runs.ts).
 */
export async function conversationForUi(userId: string, conversationId: string, upToId?: number): Promise<UiMessage[]> {
  const [rows, meta] = await Promise.all([loadMessages(conversationId, upToId), toolCatalog()]);
  const results = new Map(rows.filter((r) => r.role === "tool").map((r) => [r.toolCallId, r]));
  const lastAssistant = rows.findLast((r) => r.role === "assistant");
  const out: UiMessage[] = [];

  for (const r of rows) {
    if (r.role === "user") {
      out.push({
        id: `m${r.id}`,
        role: "user",
        parts: [{ type: "text", text: r.content ?? "" }],
      });
      continue;
    }
    if (r.role !== "assistant") continue;
    let msg = out.at(-1);
    if (msg?.role !== "assistant") {
      msg = { id: `m${r.id}`, role: "assistant", parts: [] };
      out.push(msg);
    }
    if (r.content) msg.parts.push({ type: "text", text: r.content });
    for (const c of r.toolCalls ?? []) {
      const res = results.get(c.id);
      const call = uiCall(c, meta.get(c.name));
      if (res) {
        call.status = res.toolStatus ?? "ok";
        call.result = res.content ?? "";
      } else {
        // Chưa có kết quả: chỉ hợp lệ khi là thao tác ghi ở bước cuối (đang chờ xác nhận)
        call.status = r === lastAssistant && call.write ? "awaiting" : "error";
        if (call.status === "awaiting") call.subject = await subjectOf(userId, call.args);
      }
      msg.parts.push({ type: "tool", call });
    }
  }
  return out;
}

function parseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const v = raw.trim() ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Tên mặt hàng mà lệnh ghi nhắm tới (id hoặc sku trong tham số), kể cả hàng trong thùng rác */
async function subjectOf(userId: string, args: unknown) {
  if (!args || typeof args !== "object") return undefined;
  const a = args as { id?: unknown; sku?: unknown };
  const cond =
    typeof a.id === "number" ? eq(items.id, a.id) : typeof a.sku === "string" && a.sku ? eq(items.sku, a.sku) : null;
  if (!cond) return undefined;
  const [row] = await db
    .select({ name: items.name, unit: items.unit, quantity: items.quantity })
    .from(items)
    .where(and(cond, eq(items.userId, userId)));
  return row ? `${row.name} (đang có ${row.quantity} ${row.unit})` : undefined;
}

function uiCall(c: ChatToolCall, m: ToolMeta | undefined): UiToolCall {
  const parsed = parseArgs(c.arguments);
  return {
    id: c.id,
    name: c.name,
    title: m?.title ?? c.name,
    args: parsed.ok ? parsed.value : c.arguments,
    write: m ? !m.readOnly : true,
    status: "running",
  };
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/**
 * System prompt KHÔNG chứa gì thay đổi theo ngày: template của Qwen đặt mô tả tool ngay sau system prompt,
 * giữ nguyên phần đầu này thì llama.cpp dùng lại cache (đọc lại toàn bộ tool mất ~30 giây).
 * Ngày hiện tại được gắn vào tin nhắn mới nhất của người dùng (xem withToday).
 */
function systemPrompt(user: { name: string | null; email: string }, domain: Domain) {
  const cfg = DOMAIN_CONFIG[domain];
  return [
    `Bạn là trợ lý của app "Kho đồ" của ${user.name || user.email}. App có 3 kho: Kho linh kiện (domain electronics), ` +
      `Tủ quần áo (wardrobe), Tủ bếp (pantry). Cuộc trò chuyện này thuộc ${cfg.space} (${cfg.description.toLowerCase()}); ` +
      `tool tự làm việc với kho này nếu không truyền domain.`,
    "",
    cfg.assistant.role,
    "",
    "Quy tắc:",
    "- Luôn dùng tool để lấy dữ liệu thật trước khi trả lời về kho. Không bịa tên, số lượng, giá, vị trí. Không tìm thấy thì nói rõ.",
    "- Khi thêm / sửa mặt hàng chỉ điền thông tin người dùng nói hoặc hiển nhiên từ tên (màu, size…); KHÔNG tự đặt giá, thương hiệu, nhà cung cấp.",
    "- Trả lời bằng tiếng Việt, ngắn gọn, dùng markdown; danh sách nhiều mặt hàng thì dùng bảng. Tiền là VNĐ, viết dạng 30.000 ₫.",
    "- Khi nhắc tới một mặt hàng, chèn link markdown [tên](url) với url lấy từ kết quả tool.",
    "- Brainstorm / gợi ý: luôn dựa trên inventory_snapshot (những gì THỰC SỰ có), nói rõ món nào đã có, món nào cần mua thêm.",
    "- Người dùng bảo thêm vào danh sách cần mua (hoặc đồng ý) thì gọi add_shopping_items NGAY trong lượt trả lời đó với các món còn thiếu — không hỏi lại 'có muốn thêm không'.",
    "- Tìm bằng search_items trước khi thêm mới để tránh trùng. Đổi số lượng bằng record_movement (in = nhập thêm, out = lấy ra dùng, adjust = đặt số lượng thực tế khi kiểm kê) để có lịch sử.",
    '- Thêm từ 2 món trở lên thì dùng MỘT lệnh import_items (người dùng chỉ phải xác nhận một lần), không gọi create_item nhiều lần. Danh mục / vị trí truyền bằng tên, ví dụ "Tụ điện > Tụ gốm", "Tủ lạnh > Ngăn mát".',
    "- Khi thêm mặt hàng luôn truyền createMissing=true để tự tạo danh mục / vị trí còn thiếu trong cùng lệnh — KHÔNG tạo riêng từng danh mục / vị trí trước.",
    "- Ngày (hạn sử dụng expiresAt) truyền dạng YYYY-MM-DD, vd. 2026-11-23.",
    "- Luôn truyền kind đúng nhóm trong kho cho từng món (xem mô tả tham số kind), vd. trứng / thịt = protein, gạo = grain, nước mắm = spice, áo sơ mi = top, giày = shoes, điện trở = component.",
    `- delete_item chỉ chuyển vào thùng rác (khôi phục bằng restore_item trong ${TRASH_DAYS} ngày).`,
    "- Thao tác ghi (thêm, sửa, nhập/xuất, xoá…): gọi tool luôn — app tự hiện nút Xác nhận cho người dùng, KHÔNG hỏi lại bằng lời. Nếu người dùng từ chối thì không thử lại trừ khi họ yêu cầu.",
    "- Thiếu thông tin bắt buộc (ví dụ số lượng, mặt hàng nào) thì hỏi lại ngắn gọn thay vì đoán.",
    "- Ảnh: get_item_images trả sẵn markdown ảnh, chèn nguyên văn vào câu trả lời. Muốn thêm ảnh mới thì hướng dẫn người dùng mở trang mặt hàng để tải lên.",
  ].join("\n");
}

/** Gắn ngày hiện tại (giờ Việt Nam) vào tin nhắn cuối của người dùng */
function withToday(messages: LlmMessage[]): LlmMessage[] {
  const today = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  const i = messages.findLastIndex((m) => m.role === "user");
  if (i < 0) return messages;
  const m = messages[i] as { role: "user"; content: string };
  return messages.with(i, {
    role: "user",
    content: `${m.content}

(Hôm nay: ${today})`,
  });
}

/** Lịch sử → tin nhắn cho LLM; bắt đầu từ 1 tin của người dùng để không có kết quả tool mồ côi */
function toLlmMessages(rows: ChatMessage[]): LlmMessage[] {
  let start = Math.max(0, rows.length - MAX_HISTORY);
  while (start > 0 && rows[start].role !== "user") start--;
  return rows.slice(start).map((r): LlmMessage => {
    if (r.role === "user") return { role: "user", content: r.content ?? "" };
    if (r.role === "tool")
      return {
        role: "tool",
        tool_call_id: r.toolCallId ?? "",
        content: r.content ?? "",
      };
    return {
      role: "assistant",
      content: r.content || null,
      ...(r.toolCalls?.length
        ? {
            tool_calls: r.toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: c.arguments || "{}" },
            })),
          }
        : {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Vòng lặp agent                                                      */
/* ------------------------------------------------------------------ */

const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "Cuộc trò chuyện mới";
};

async function saveRow(values: typeof chatMessages.$inferInsert) {
  const [row] = await db.insert(chatMessages).values(values).returning();
  return row;
}

/**
 * Một lượt chat trên cuộc trò chuyện đã có (người gọi đã kiểm tra quyền sở hữu).
 * Có thể là tin nhắn mới (message) và/hoặc quyết định cho các thao tác ghi đang chờ (decisions).
 * Chạy nền qua lib/chat/runs.ts — không phụ thuộc kết nối của trình duyệt.
 */
export async function* runChat(opts: {
  user: { id: string; name: string | null; email: string };
  conversationId: string;
  message?: string | null;
  decisions?: Record<string, ChatDecision>;
  signal: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
  const { user, signal, conversationId } = opts;
  const message = opts.message?.trim() || null;

  const [conv] = await db
    .select({ domain: chatConversations.domain })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId));
  const domain: Domain = conv?.domain ?? "electronics";
  const toolset = await openToolset(user.id, domain);
  try {
    // 1. Xử lý các thao tác ghi đang chờ xác nhận
    const rows = await loadMessages(conversationId);
    const done = new Set(rows.filter((r) => r.role === "tool").map((r) => r.toolCallId));
    const last = rows.findLast((r) => r.role === "assistant");
    const pending = (last?.toolCalls ?? []).filter((c) => !done.has(c.id));

    for (const c of pending) {
      const decision = opts.decisions?.[c.id];
      let status: ChatToolStatus;
      let text: string;
      if (decision === "approve") {
        const args = parseArgs(c.arguments);
        ({ status, text } = args.ok
          ? await toolset.call(c.name, args.value)
          : {
              status: "error" as const,
              text: "Tham số không phải JSON hợp lệ",
            });
      } else {
        status = "rejected";
        text =
          decision === "reject"
            ? "Người dùng đã từ chối thao tác này."
            : "Người dùng bỏ qua thao tác này (đã gửi tin nhắn khác).";
      }
      await saveRow({
        conversationId,
        role: "tool",
        toolCallId: c.id,
        toolName: c.name,
        toolStatus: status,
        content: text,
      });
      yield { type: "tool_result", id: c.id, status, result: text };
    }

    // Chỉ có quyết định mà không có thao tác nào được duyệt → không cần hỏi lại model
    const anyApproved = pending.some((c) => opts.decisions?.[c.id] === "approve");
    if (!message && !anyApproved) {
      yield { type: "done", awaiting: false };
      return;
    }

    // 2. Tin nhắn mới của người dùng
    if (message) {
      const row = await saveRow({
        conversationId,
        role: "user",
        content: message,
      });
      yield {
        type: "user",
        message: {
          id: `m${row.id}`,
          role: "user",
          parts: [{ type: "text", text: message }],
        },
      };
    }

    // 3. Gọi model, chạy tool đọc, dừng khi gặp thao tác ghi cần xác nhận
    let awaiting = false;
    for (let step = 0; step < MAX_STEPS && !awaiting; step++) {
      const history = await loadMessages(conversationId);
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt(user, domain) },
        ...withToday(toLlmMessages(history)),
      ];

      let text = "";
      let thinking = false;
      let toolCalls: ChatToolCall[] = [];
      try {
        for await (const ev of streamChat({
          messages,
          tools: toolset.tools,
          signal,
        })) {
          if (ev.type === "reasoning") {
            if (!thinking && !text) yield { type: "thinking" };
            thinking = true;
          } else if (ev.type === "text") {
            // Bỏ khoảng trắng đầu (model hay xuống dòng sau khối suy nghĩ)
            const delta = text ? ev.delta : ev.delta.replace(/^\s+/, "");
            if (!delta) continue;
            text += delta;
            yield { type: "text", delta };
          } else {
            toolCalls = ev.toolCalls;
          }
        }
      } catch (err) {
        if (signal.aborted) {
          if (text.trim())
            await saveRow({
              conversationId,
              role: "assistant",
              content: text.trim(),
            });
          return;
        }
        throw err;
      }

      await saveRow({
        conversationId,
        role: "assistant",
        content: text.trim() || null,
        toolCalls: toolCalls.length ? toolCalls : null,
      });
      if (!toolCalls.length) break;

      for (const c of toolCalls) {
        const call = uiCall(c, toolset.meta.get(c.name));
        if (call.write && toolset.meta.has(c.name) && typeof call.args === "object") {
          awaiting = true;
          yield {
            type: "tool_call",
            call: {
              ...call,
              status: "awaiting",
              subject: await subjectOf(user.id, call.args),
            },
          };
          continue;
        }
        yield { type: "tool_call", call };
        const args = parseArgs(c.arguments);
        const { status, text: result } = args.ok
          ? await toolset.call(c.name, args.value)
          : {
              status: "error" as const,
              text: "Tham số không phải JSON hợp lệ — hãy gọi lại với JSON đúng",
            };
        await saveRow({
          conversationId,
          role: "tool",
          toolCallId: c.id,
          toolName: c.name,
          toolStatus: status,
          content: result,
        });
        yield { type: "tool_result", id: c.id, status, result };
      }
      if (step === MAX_STEPS - 1 && !awaiting) {
        const note = `\n\n_(Đã dừng sau ${MAX_STEPS} bước gọi công cụ — hãy nhắn tiếp nếu cần.)_`;
        await saveRow({
          conversationId,
          role: "assistant",
          content: note.trim(),
        });
        yield { type: "text", delta: note };
      }
    }

    yield { type: "done", awaiting };
  } catch (err) {
    if (signal.aborted) return;
    console.error("[chat]", err);
    yield {
      type: "error",
      message: err instanceof LlmError ? err.message : "Có lỗi khi xử lý, vui lòng thử lại",
    };
  } finally {
    await db
      .update(chatConversations)
      .set({ updatedAt: sql`now()` })
      .where(eq(chatConversations.id, conversationId))
      .catch(() => {});
    await toolset.close();
  }
}
