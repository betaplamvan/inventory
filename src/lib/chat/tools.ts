import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChatToolStatus, Domain } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp/server";
import type { LlmTool } from "./llm";

/**
 * Bộ tool của trợ lý chat = chính các tool MCP (lib/mcp/server.ts), chạy trong cùng tiến trình
 * qua InMemoryTransport → chatbot và Claude/agent luôn có cùng khả năng, không phải viết lại.
 */

/** Tool không hợp với chat trên web (cần chạy lệnh shell để upload file) */
const EXCLUDED = new Set(["create_upload_url"]);

/** Kết quả tool gửi lại cho model: cắt bớt để không tràn context */
const MAX_RESULT_CHARS = 12_000;

export const CHAT_AGENT_NAME = "Trợ lý chat";

export type ToolMeta = { name: string; title: string; readOnly: boolean };

type Toolset = {
  tools: LlmTool[];
  meta: Map<string, ToolMeta>;
  call(name: string, args: Record<string, unknown>): Promise<{ status: ChatToolStatus; text: string }>;
  close(): Promise<void>;
};

async function connect(userId: string, defaultDomain?: Domain) {
  const server = buildMcpServer({
    userId,
    scope: "write",
    tokenName: CHAT_AGENT_NAME,
    defaultDomain,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "web-chat", version: "1.0.0" });
  await client.connect(clientTransport);
  return { server, client };
}

/** defaultDomain: kho của cuộc trò chuyện — tool không truyền domain sẽ làm việc với kho này */
export async function openToolset(userId: string, defaultDomain?: Domain): Promise<Toolset> {
  const { server, client } = await connect(userId, defaultDomain);
  const { tools } = await client.listTools();
  const usable = tools.filter((t) => !EXCLUDED.has(t.name));

  const meta = new Map<string, ToolMeta>(
    usable.map((t) => [
      t.name,
      {
        name: t.name,
        title: t.title ?? t.annotations?.title ?? t.name,
        readOnly: !!t.annotations?.readOnlyHint,
      },
    ]),
  );

  return {
    meta,
    tools: usable.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          ...(t.inputSchema as Record<string, unknown>),
          $schema: undefined,
        },
      },
    })),
    async call(name, args) {
      if (!meta.has(name)) return { status: "error", text: `Không có tool "${name}"` };
      try {
        const res = (await client.callTool({
          name,
          arguments: args,
        })) as CallToolResult;
        return { status: res.isError ? "error" : "ok", text: resultText(res) };
      } catch (err) {
        return {
          status: "error",
          text: `Lỗi khi chạy tool: ${(err as Error).message}`,
        };
      }
    },
    async close() {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

function resultText(res: CallToolResult) {
  const parts: string[] = [];
  let images = 0;
  for (const c of res.content ?? []) {
    if (c.type === "text") parts.push(c.text);
    else if (c.type === "image") images++;
  }
  // Model chỉ đọc chữ: ảnh base64 bỏ đi, URL / markdown ảnh đã nằm trong phần text
  if (images) parts.push(`(kèm ${images} ảnh — dùng markdown ảnh ở trên để hiển thị cho người dùng)`);
  const text = parts.join("\n").trim() || "(không có nội dung)";
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…(đã cắt bớt)` : text;
}

/** Tên hiển thị + loại (đọc / ghi) của các tool — dùng khi dựng lại lịch sử chat, không phụ thuộc user */
let catalog: Promise<Map<string, ToolMeta>> | null = null;
export function toolCatalog() {
  catalog ??= (async () => {
    const set = await openToolset("00000000-0000-0000-0000-000000000000");
    await set.close();
    return set.meta;
  })().catch((err) => {
    catalog = null;
    throw err;
  });
  return catalog;
}
