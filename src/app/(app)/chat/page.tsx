import { Suspense } from "react";
import { connection } from "next/server";
import { Bot } from "lucide-react";
import { ChatApp } from "@/components/chat/chat-app";
import { Skeleton } from "@/components/ui";
import { llmConfigured } from "@/lib/chat/llm";
import { currentDomain } from "@/lib/domain-server";
import { DomainSync } from "@/components/domain";
import { getConversation } from "@/lib/chat/agent";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Trợ lý" };

export default function ChatPage(props: PageProps<"/chat">) {
  return (
    <Suspense fallback={<Skeleton className="h-[70dvh]" />}>
      <Chat searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Chat({ searchParams }: { searchParams: PageProps<"/chat">["searchParams"] }) {
  await connection(); // đọc cấu hình LLM lúc chạy, không lúc build
  if (!llmConfigured()) {
    return (
      <div className="card mx-auto max-w-lg space-y-3 p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
          <Bot className="size-6" />
        </span>
        <h1 className="font-semibold">Chưa cấu hình trợ lý</h1>
        <p className="text-sm text-muted">
          Đặt <code>LLM_BASE_URL</code> (server có API kiểu OpenAI, ví dụ llama.cpp / vLLM / Ollama) và{" "}
          <code>LLM_API_KEY</code> nếu server cần, rồi khởi động lại app.
        </p>
      </div>
    );
  }
  const sp = await searchParams;
  const c = typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;
  // Mở 1 cuộc trò chuyện cụ thể (vd. bấm phóng to từ khung chat nổi) → dùng KHO CỦA CUỘC ĐÓ và đồng bộ giao diện
  // sang kho đó, thay vì cookie (có thể lệch nếu trang được trình duyệt cache từ lúc ở kho khác)
  const me = await requireUser();
  const conv = c ? await getConversation(me.id, c) : null;
  const domain = conv?.domain ?? (await currentDomain());
  // key: đổi kho → danh sách cuộc trò chuyện và khung chat của kho mới
  return (
    <>
      <DomainSync domain={domain} />
      <ChatApp key={domain} initialId={conv ? conv.id : null} domain={domain} />
    </>
  );
}
