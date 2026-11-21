"use client";

import { useActionState, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { createToken, revokeToken, type CreateTokenState } from "@/actions/api-tokens";
import { fmtDateTime } from "@/lib/format";
import { ConfirmButton, SubmitButton } from "./confirm-button";

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  oauth: boolean;
  expired: boolean;
};

export function ApiTokensPanel({ tokens, mcpUrl }: { tokens: TokenRow[]; mcpUrl: string }) {
  const [state, action] = useActionState<CreateTokenState, FormData>(createToken, null);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Cho AI agent (Claude Code, Claude Desktop, Cursor…) đọc và thêm dữ liệu vào kho qua MCP. Địa chỉ MCP:{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs break-all text-foreground">{mcpUrl}</code>
      </p>
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
        <b className="text-foreground">Claude web / điện thoại:</b> Settings → Connectors → Add custom connector, dán địa chỉ MCP ở
        trên rồi đăng nhập Google để cho phép — không cần token. Claude Code cũng vậy:{" "}
        <code className="text-xs break-all text-foreground">claude mcp add --transport http kho-do {mcpUrl}</code> rồi gõ{" "}
        <code className="text-xs text-foreground">/mcp</code> để đăng nhập. Kết nối OAuth hiện trong danh sách bên dưới.
      </p>

      {state?.ok && state.token && <NewTokenCard token={state.token} mcpUrl={mcpUrl} scope={state.scope!} />}

      {showForm ? (
        <form action={action} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <label className="label">Tên token</label>
            <input name="name" className="input" placeholder="VD: Claude Code laptop" autoFocus />
          </div>
          <div>
            <label className="label">Quyền</label>
            <select name="scope" className="input" defaultValue="write">
              <option value="write">Đọc + ghi</option>
              <option value="read">Chỉ đọc</option>
            </select>
          </div>
          <div>
            <label className="label">Hết hạn</label>
            <select name="expires" className="input" defaultValue="90">
              <option value="30">30 ngày</option>
              <option value="90">90 ngày</option>
              <option value="365">1 năm</option>
              <option value="0">Không hết hạn</option>
            </select>
          </div>
          <SubmitButton>
            <KeyRound className="size-4" /> Tạo
          </SubmitButton>
          {state?.error && <p className="text-sm text-danger sm:col-span-4">{state.error}</p>}
        </form>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> Tạo API token
        </button>
      )}

      {tokens.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <KeyRound className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t.name}{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] ${t.scope === "write" ? "bg-accent-soft text-accent-strong" : "bg-surface-2 text-muted"}`}>
                    {t.scope === "write" ? "đọc + ghi" : "chỉ đọc"}
                  </span>
                  {t.oauth && <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">OAuth</span>}
                  {t.expired && <span className="ml-1 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] text-danger">hết hạn</span>}
                </p>
                <p className="text-xs text-muted">
                  {t.oauth ? "kết nối" : <span className="font-mono">{t.prefix}…</span>} · tạo {fmtDateTime(t.createdAt)} ·{" "}
                  {t.lastUsedAt ? `dùng lần cuối ${fmtDateTime(t.lastUsedAt)}` : "chưa dùng"}
                  {t.expiresAt && !t.expired && ` · hết hạn ${fmtDateTime(t.expiresAt)}`}
                </p>
              </div>
              <form action={revokeToken.bind(null, t.id)}>
                <ConfirmButton className="btn-ghost btn-sm hover:text-danger" title="Thu hồi" message={
                    t.oauth
                      ? `Ngắt kết nối "${t.name}"? Ứng dụng này sẽ phải xin quyền lại.`
                      : `Thu hồi token "${t.name}"? Agent đang dùng token này sẽ mất quyền truy cập.`
                  }>
                  <Trash2 className="size-3.5" /> Thu hồi
                </ConfirmButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTokenCard({ token, mcpUrl, scope }: { token: string; mcpUrl: string; scope: "read" | "write" }) {
  const claudeCode = `claude mcp add --transport http kho-do ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  const jsonConfig = JSON.stringify(
    { mcpServers: { "kho-do": { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        "kho-do": {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${INVENTORY_AUTH}"],
          env: { INVENTORY_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return (
    <div className="space-y-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-4">
      <p className="text-sm font-medium text-accent-strong">
        Token mới ({scope === "write" ? "đọc + ghi" : "chỉ đọc"}) — chỉ hiện <b>một lần</b>, hãy lưu lại ngay.
      </p>
      <CopyBlock label="Token" value={token} />
      <CopyBlock label="Claude Code (chạy trong terminal)" value={claudeCode} />
      <CopyBlock label="Cursor / .mcp.json / client hỗ trợ HTTP" value={jsonConfig} />
      <CopyBlock label="Claude Desktop (claude_desktop_config.json, qua mcp-remote)" value={desktopConfig} />
    </div>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">{value}</pre>
    </div>
  );
}
