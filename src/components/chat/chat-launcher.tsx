"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Bot, Maximize2, MessageSquarePlus, X } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { isDraft, newDraftKey, readLast, writeLast } from "./store";

/** Nút nổi mở nhanh trợ lý ở mọi trang (ẩn ở trang /chat). usePathname cần Suspense. */
export function ChatLauncher() {
  return (
    <Suspense fallback={null}>
      <Launcher />
    </Suspense>
  );
}

function Launcher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  /** id cuộc trò chuyện, hoặc khoá nháp "new:…" cho cuộc mới (trạng thái thật nằm trong ./store) */
  const [conversationKey, setConversationKey] = useState<string>(() => newDraftKey());
  const conversationId = isDraft(conversationKey) ? null : conversationKey;

  const show = () => {
    // Mở lại đúng cuộc gần nhất (có thể vừa đổi ở trang /chat); cuộc mới chưa gửi thì giữ nguyên
    const last = readLast();
    if (last && last !== conversationKey) setConversationKey(last);
    setMounted(true);
    setOpen(true);
  };

  // Điện thoại: panel phủ toàn màn hình → khoá cuộn trang phía sau; Esc để đóng
  useEffect(() => {
    if (!open) return;
    const small = window.matchMedia("(width < 64rem)").matches;
    if (small) document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onCreated = useCallback((id: string) => {
    setConversationKey(id);
    writeLast(id);
  }, []);

  if (pathname?.startsWith("/chat")) return null;

  const startNew = () => {
    setConversationKey(newDraftKey());
    writeLast(null);
  };

  return (
    // data-floating-layer: tự ẩn khi đang xem hướng dẫn (tour) để không che phần tử được chỉ
    <div className="print:hidden" data-floating-layer>
      {!open && (
        <button
          type="button"
          onClick={show}
          aria-label="Mở trợ lý"
          title="Trợ lý"
          className="fixed right-4 bottom-[calc(var(--tabbar)+1rem)] z-30 grid size-13 place-items-center rounded-full bg-accent text-on-accent shadow-lg ring-1 ring-black/10 transition hover:bg-accent-hover active:scale-90 lg:right-6 lg:bottom-6"
        >
          <Bot className="size-6" />
        </button>
      )}

      {mounted && (
        <div
          role="dialog"
          aria-label="Trợ lý"
          hidden={!open}
          className="fixed inset-0 z-50 flex flex-col bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:inset-auto lg:right-6 lg:bottom-6 lg:h-[min(42rem,calc(100dvh-3rem))] lg:w-[26rem] lg:overflow-hidden lg:rounded-xl lg:border lg:border-border lg:p-0 lg:shadow-2xl"
        >
          <header className="flex items-center gap-1 border-b border-border px-3 py-2">
            <Bot className="size-4 text-accent-strong" />
            <span className="flex-1 text-sm font-semibold">Trợ lý</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={startNew}
              aria-label="Cuộc trò chuyện mới"
              title="Cuộc trò chuyện mới"
            >
              <MessageSquarePlus className="size-4" />
            </button>
            <Link
              href={conversationId ? `/chat?c=${conversationId}` : "/chat"}
              className="btn-ghost btn-sm"
              aria-label="Mở trang trợ lý"
              title="Mở trang đầy đủ"
              onClick={() => setOpen(false)}
            >
              <Maximize2 className="size-4" />
            </Link>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setOpen(false)}
              aria-label="Đóng"
              title="Đóng"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1">
            <ChatPanel conversationKey={conversationKey} onCreated={onCreated} onNotFound={startNew} compact />
          </div>
        </div>
      )}
    </div>
  );
}
