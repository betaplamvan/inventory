import { Suspense } from "react";
import { connection } from "next/server";
import { llmConfigured } from "@/lib/chat/llm";
import { ChatLauncher } from "./chat-launcher";

/** Chỉ hiện nút trợ lý khi đã cấu hình LLM — kiểm tra lúc chạy (không prerender theo env lúc build). */
export function ChatLauncherSlot() {
  return (
    <Suspense fallback={null}>
      <Slot />
    </Suspense>
  );
}

async function Slot() {
  await connection();
  return llmConfigured() ? <ChatLauncher /> : null;
}
