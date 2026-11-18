import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/auth/api-tokens";
import { getCurrentUser } from "@/lib/auth/session";
import { InventoryError } from "@/lib/inventory/mutations";
import { MediaStorageError, addItemMediaFor, mediaKindOf } from "@/lib/inventory/media";

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 500);
/** Ảnh nhỏ hơn mức này được đọc vào bộ nhớ để tạo thumbnail */
const THUMB_MAX_BYTES = 40 * 1024 * 1024;

/**
 * Xác định người upload:
 *  - có header Authorization → bắt buộc API token hợp lệ, quyền ghi (AI agent / script);
 *  - không có → cookie phiên đăng nhập (giao diện web).
 */
async function uploader(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const authorization = req.headers.get("authorization");
  if (authorization) {
    const auth = await verifyBearer(authorization);
    if (!auth) {
      return NextResponse.json(
        { error: "Thiếu hoặc sai API token (Authorization: Bearer inv_…)" },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="inventory"' } },
      );
    }
    if (auth.scope !== "write") {
      return NextResponse.json({ error: "Token này chỉ có quyền đọc (scope=read)" }, { status: 403 });
    }
    return { userId: auth.userId };
  }
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  return { userId: me.id };
}

/**
 * Upload 1 file thô (body = nội dung file).
 * POST /api/media/upload?itemId=1&filename=abc.jpg[&cover=1]   (header Content-Type = loại file)
 * Đăng nhập bằng cookie (web) hoặc "Authorization: Bearer inv_…" (token quyền ghi).
 */
export async function POST(req: NextRequest) {
  const who = await uploader(req);
  if (who instanceof NextResponse) return who;

  const itemId = Number(req.nextUrl.searchParams.get("itemId"));
  const filename = req.nextUrl.searchParams.get("filename") || "file";
  const setCover = ["1", "true"].includes(req.nextUrl.searchParams.get("cover") ?? "");
  const contentType = (req.headers.get("content-type") || "application/octet-stream").split(";")[0];
  const sizeHeader = Number(req.headers.get("content-length") || 0);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "itemId không hợp lệ" }, { status: 400 });
  }
  if (!req.body) return NextResponse.json({ error: "File rỗng" }, { status: 400 });
  if (sizeHeader > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File vượt quá ${MAX_MB}MB` }, { status: 413 });
  }

  try {
    const bufferIt = mediaKindOf(contentType) === "image" && sizeHeader > 0 && sizeHeader <= THUMB_MAX_BYTES;
    const body = bufferIt
      ? Buffer.from(await req.arrayBuffer())
      : Readable.fromWeb(req.body as unknown as NodeWebStream);
    const row = await addItemMediaFor(who.userId, itemId, {
      body,
      size: sizeHeader || undefined,
      filename,
      contentType,
      setCover,
    });
    revalidatePath("/", "layout");
    return NextResponse.json({ media: row });
  } catch (err) {
    if (err instanceof MediaStorageError) return NextResponse.json({ error: err.message }, { status: 502 });
    if (err instanceof InventoryError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("[upload]", err);
    return NextResponse.json({ error: "Có lỗi xảy ra, vui lòng thử lại" }, { status: 500 });
  }
}
