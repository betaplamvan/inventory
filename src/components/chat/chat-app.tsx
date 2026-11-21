"use client";

import { useCallback, useEffect, useState } from "react";
import { History, MessageSquarePlus, Trash2, X } from "lucide-react";
import type { ConversationSummary } from "@/lib/chat/types";
import { fmtDateTime } from "@/lib/format";
import { ChatPanel } from "./chat-panel";
import type { Domain } from "@/lib/domains";
import { forget, newDraftKey, writeLast } from "./store";

/** Đổi ?c= trên thanh địa chỉ mà không điều hướng (giữ nguyên trạng thái đang stream) */
function syncUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  window.history.replaceState(window.history.state, "", url);
}

export function ChatApp({ initialId, domain }: { initialId: string | null; domain: Domain }) {
  /** id cuộc trò chuyện đang mở, hoặc khoá nháp "new:…" cho cuộc mới */
  const [activeKey, setActiveKey] = useState<string>(() => initialId ?? newDraftKey());
  const activeId = activeKey.startsWith("new:") ? null : activeKey;
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [drawer, setDrawer] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/chat/conversations?domain=${domain}`).catch(() => null);
    if (res?.ok) setList(((await res.json()) as { conversations: ConversationSummary[] }).conversations);
  }, [domain]);

  useEffect(() => {
    fetch(`/api/chat/conversations?domain=${domain}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ conversations: ConversationSummary[] }>) : null))
      .then((data) => data && setList(data.conversations))
      .catch(() => {});
    // Store báo có hoạt động (tạo cuộc mới, trả lời xong) → cập nhật thứ tự danh sách
    const onActivity = () => void refresh();
    window.addEventListener("kho:chat-activity", onActivity);
    return () => window.removeEventListener("kho:chat-activity", onActivity);
  }, [domain, refresh]);

  // Khung chat nổi ở trang khác mở lại đúng cuộc đang xem
  useEffect(() => {
    if (initialId) writeLast(domain, initialId);
  }, [domain, initialId]);

  const open = (id: string | null) => {
    setActiveKey(id ?? newDraftKey());
    syncUrl(id);
    writeLast(domain, id);
    setDrawer(false);
  };

  const remove = async (c: ConversationSummary) => {
    if (!confirm(`Xoá cuộc trò chuyện "${c.title}"?`)) return;
    await fetch(`/api/chat/conversations/${c.id}`, { method: "DELETE" });
    forget(c.id);
    setList((l) => l?.filter((x) => x.id !== c.id) ?? null);
    if (activeId === c.id) open(null);
  };

  const onCreated = useCallback((id: string, title: string) => {
    setActiveKey(id);
    syncUrl(id);
    writeLast(domain, id);
    setList((l) => [{ id, title, updatedAt: new Date().toISOString() }, ...(l ?? [])]);
  }, [domain]);

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <button type="button" className="btn-primary w-full" onClick={() => open(null)}>
          <MessageSquarePlus className="size-4" /> Cuộc trò chuyện mới
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {list === null && <li className="px-2 py-2 text-sm text-muted">Đang tải…</li>}
        {list?.length === 0 && <li className="px-2 py-2 text-sm text-muted">Chưa có cuộc trò chuyện nào</li>}
        {list?.map((c) => (
          <li key={c.id} className="group relative">
            <button
              type="button"
              onClick={() => open(c.id)}
              className={`w-full rounded-lg px-3 py-2 pr-9 text-left text-sm transition ${
                c.id === activeId ? "bg-accent-soft text-accent-strong" : "hover:bg-surface-2"
              }`}
            >
              <span className="line-clamp-2 font-medium">{c.title}</span>
              <span className="text-xs text-muted">{fmtDateTime(new Date(c.updatedAt))}</span>
            </button>
            <button
              type="button"
              onClick={() => remove(c)}
              aria-label="Xoá"
              title="Xoá"
              className="btn-ghost btn-sm absolute top-1.5 right-1 hover:text-danger can-hover:opacity-0 can-hover:group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const title = list?.find((c) => c.id === activeId)?.title ?? "Cuộc trò chuyện mới";

  return (
    <div className="card flex h-[calc(100dvh-var(--tabbar)-env(safe-area-inset-top)-5.5rem)] min-h-[24rem] overflow-hidden lg:h-[calc(100dvh-4rem)]">
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">{sidebar}</aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            className="btn-ghost btn-sm md:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Lịch sử"
          >
            <History className="size-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
          <button
            type="button"
            className="btn-ghost btn-sm md:hidden"
            onClick={() => open(null)}
            aria-label="Cuộc trò chuyện mới"
          >
            <MessageSquarePlus className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <ChatPanel conversationKey={activeKey} domain={domain} onCreated={onCreated} onNotFound={() => open(null)} />
        </div>
      </section>

      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setDrawer(false)}>
          <div
            className="absolute inset-y-0 left-0 w-[85%] max-w-xs bg-surface pt-[env(safe-area-inset-top)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Lịch sử trò chuyện</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDrawer(false)} aria-label="Đóng">
                <X className="size-4" />
              </button>
            </div>
            <div className="h-[calc(100%-2.75rem)]">{sidebar}</div>
          </div>
        </div>
      )}
    </div>
  );
}
