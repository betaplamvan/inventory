import "server-only";

/**
 * Client tối giản cho LLM tự host có API kiểu OpenAI (llama.cpp server, vLLM, Ollama /v1…).
 *   LLM_BASE_URL  ví dụ https://llm.example.com (có hoặc không có /v1)
 *   LLM_API_KEY   gửi dạng Authorization: Bearer (bỏ trống nếu server không cần)
 *   LLM_MODEL     tuỳ chọn; mặc định lấy model đầu tiên của /v1/models
 */

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | {
      type: "done";
      toolCalls: { id: string; name: string; arguments: string }[];
      finishReason: string | null;
    };

export class LlmError extends Error {}

export const llmConfigured = () => !!process.env.LLM_BASE_URL;

function apiBase() {
  const base = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function headers() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.LLM_API_KEY) h.Authorization = `Bearer ${process.env.LLM_API_KEY}`;
  return h;
}

let cachedModel: string | null = null;

export async function resolveModel(): Promise<string> {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (cachedModel) return cachedModel;
  const res = await fetch(`${apiBase()}/models`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new LlmError(`Không lấy được danh sách model (HTTP ${res.status})`);
  const data = (await res.json()) as { data?: { id: string }[] };
  const id = data.data?.[0]?.id;
  if (!id) throw new LlmError("Server LLM không có model nào");
  cachedModel = id;
  return id;
}

/**
 * Tách khối <think>…</think> (Qwen3 / DeepSeek khi server không tự tách reasoning_content)
 * ra khỏi nội dung trả lời. Thẻ có thể bị cắt giữa 2 chunk nên giữ lại phần đuôi chưa chắc chắn.
 */
class ThinkSplitter {
  private inThink = false;
  private carry = "";

  push(chunk: string): { text: string; reasoning: string } {
    let s = this.carry + chunk;
    this.carry = "";
    let text = "";
    let reasoning = "";
    while (s) {
      const tag = this.inThink ? "</think>" : "<think>";
      const i = s.indexOf(tag);
      if (i >= 0) {
        if (this.inThink) reasoning += s.slice(0, i);
        else text += s.slice(0, i);
        s = s.slice(i + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // Giữ lại đuôi có thể là đầu của thẻ
      let keep = 0;
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
        if (tag.startsWith(s.slice(-k))) {
          keep = k;
          break;
        }
      }
      const out = s.slice(0, s.length - keep);
      if (this.inThink) reasoning += out;
      else text += out;
      this.carry = s.slice(s.length - keep);
      s = "";
    }
    return { text, reasoning };
  }

  flush() {
    const rest = this.carry;
    this.carry = "";
    return this.inThink ? { text: "", reasoning: rest } : { text: rest, reasoning: "" };
  }
}

/** 1 dòng log mỗi lần gọi: prompt mới phải đọc bao nhiêu token, bao nhiêu lấy từ cache (llama.cpp) */
function logTimings(t: {
  prompt_n?: number;
  prompt_ms?: number;
  cache_n?: number;
  predicted_n?: number;
  predicted_ms?: number;
}) {
  const sec = (ms?: number) => ((ms ?? 0) / 1000).toFixed(1);
  console.log(
    `[llm] prompt ${t.prompt_n ?? "?"} tok mới + ${t.cache_n ?? 0} tok cache (${sec(t.prompt_ms)}s), sinh ${t.predicted_n ?? "?"} tok (${sec(t.predicted_ms)}s)`,
  );
}

type StreamDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

/** Gọi /chat/completions dạng stream, phát lần lượt text / reasoning, cuối cùng là các lệnh gọi tool. */
export async function* streamChat(opts: {
  messages: LlmMessage[];
  tools?: LlmTool[];
  signal?: AbortSignal;
}): AsyncGenerator<LlmEvent> {
  const model = await resolveModel();
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/chat/completions`, {
      method: "POST",
      headers: headers(),
      signal: opts.signal,
      body: JSON.stringify({
        model,
        messages: opts.messages,
        ...(opts.tools?.length
          ? {
              tools: opts.tools,
              tool_choice: "auto",
              parallel_tool_calls: true,
            }
          : {}),
        stream: true,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new LlmError(`Không kết nối được server LLM: ${(err as Error).message}`);
  }
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new LlmError(`Server LLM trả lỗi HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const splitter = new ThinkSplitter();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason: string | null = null;
  const decoder = new TextDecoder();
  let buf = "";

  const handle = function* (data: string): Generator<LlmEvent> {
    if (data === "[DONE]") return;
    let json: {
      choices?: { delta?: StreamDelta; finish_reason?: string | null }[];
      error?: { message?: string };
      /** llama.cpp gửi kèm ở chunk cuối */
      timings?: {
        prompt_n?: number;
        prompt_ms?: number;
        cache_n?: number;
        predicted_n?: number;
        predicted_ms?: number;
      };
    };
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.error) throw new LlmError(json.error.message || "Server LLM báo lỗi");
    if (json.timings) logTimings(json.timings);
    const choice = json.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const d = choice.delta ?? {};
    if (d.reasoning_content) yield { type: "reasoning", delta: d.reasoning_content };
    if (d.content) {
      const { text, reasoning } = splitter.push(d.content);
      if (reasoning) yield { type: "reasoning", delta: reasoning };
      if (text) yield { type: "text", delta: text };
    }
    for (const tc of d.tool_calls ?? []) {
      const idx = tc.index ?? calls.size;
      const cur = calls.get(idx) ?? { id: "", name: "", arguments: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
      calls.set(idx, cur);
    }
  };

  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield* handle(line.slice(5).trim());
      }
    }
    if (buf.trim().startsWith("data:")) yield* handle(buf.trim().slice(5).trim());
  } finally {
    reader.releaseLock();
  }

  const rest = splitter.flush();
  if (rest.reasoning) yield { type: "reasoning", delta: rest.reasoning };
  if (rest.text) yield { type: "text", delta: rest.text };

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c], i) => ({
      ...c,
      id: c.id || `call_${Date.now().toString(36)}_${i}`,
    }))
    .filter((c) => c.name);
  yield { type: "done", toolCalls, finishReason };
}
