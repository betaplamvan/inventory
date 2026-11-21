import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { WebError, fetchWebImage } from "@/lib/chat/web";

/**
 * Proxy ảnh từ web cho khung chat (kết quả image_search, ảnh trợ lý chèn vào câu trả lời).
 * - Chỉ người đã đăng nhập (không thành proxy mở cho người ngoài).
 * - Trình duyệt không gọi thẳng site lạ → không lộ IP / cookie người xem, không bị ảnh theo dõi.
 * - Tải qua fetchWebImage: chặn địa chỉ nội bộ, chỉ nhận JPEG / PNG / WebP / GIF / AVIF / BMP (không SVG), tối đa 5MB.
 *   GET /api/web-image?u=<url ảnh>
 */
export async function GET(req: NextRequest) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const u = req.nextUrl.searchParams.get("u");
  if (!u || u.length > 2000) return new Response("Thiếu hoặc sai tham số u", { status: 400 });
  try {
    const img = await fetchWebImage(u);
    return new Response(new Uint8Array(img.body), {
      headers: {
        "Content-Type": img.contentType,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        // Có lỡ là nội dung lạ cũng không chạy được script dưới origin của app
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    const msg = err instanceof WebError ? err.message : "Không tải được ảnh";
    return new Response(msg, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
