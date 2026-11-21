"use client";

import Link from "next/link";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Đường dẫn trong app (tương đối, hoặc tuyệt đối cùng origin) → path; link ngoài → null */
function internalPath(href: string | undefined) {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const u = new URL(href);
    return typeof window !== "undefined" && u.origin === window.location.origin ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}

const components: Components = {
  a({ href, children }) {
    const path = internalPath(href);
    if (path) return <Link href={path}>{children}</Link>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  // Chỉ hiện ảnh của chính app (ảnh mặt hàng): model không thể chèn ảnh từ nơi khác (theo dõi / lừa đảo)
  img({ src, alt }) {
    const path = typeof src === "string" ? internalPath(src) : null;
    if (!path) return <span className="text-muted">[{alt || "ảnh"}]</span>;
    return (
      <a href={path.replace(/([?&])thumb=1(&|$)/, "$1").replace(/[?&]$/, "")} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh động từ /api/media, kích thước không cố định */}
        <img src={path} alt={alt ?? ""} loading="lazy" />
      </a>
    );
  },
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-md text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
