import { getCurrentUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/chat/agent";
import { currentDomain } from "@/lib/domain-server";
import { isDomain } from "@/lib/domains";

/** Danh sách cuộc trò chuyện với trợ lý của 1 kho (?domain=…, mặc định kho đang chọn), mới nhất trước. */
export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("domain");
  const domain = isDomain(q) ? q : await currentDomain();
  return Response.json(
    { conversations: await listConversations(me.id, domain) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
