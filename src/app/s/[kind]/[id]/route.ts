import { type NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/auth/constants";

/**
 * Link ngắn in trên nhãn QR — quét bằng camera thường của điện thoại cũng mở đúng trang:
 *   /s/i/<id> → mặt hàng       /s/l/<id> → danh sách hàng ở vị trí đó
 * Chưa đăng nhập thì proxy chuyển qua /login rồi quay lại đây. Quyền xem do trang đích kiểm tra.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/s/[kind]/[id]">) {
  const { kind, id } = await ctx.params;
  const n = Number(id);
  const base = appBaseUrl();
  if (!Number.isInteger(n) || n <= 0) return NextResponse.redirect(`${base}/scan`, 307);
  if (kind === "i") return NextResponse.redirect(`${base}/items/${n}`, 307);
  if (kind === "l") return NextResponse.redirect(`${base}/items?location=${n}`, 307);
  return NextResponse.redirect(`${base}/scan`, 307);
}
