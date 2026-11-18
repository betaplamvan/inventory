import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/auth/api-tokens";
import { getCurrentUser } from "@/lib/auth/session";
import { InventoryError } from "@/lib/inventory/mutations";
import { MediaStorageError, addItemMediaFor, mediaKindOf, resolveContentType } from "@/lib/inventory/media";
import { consumeUploadLink } from "@/lib/inventory/upload-links";

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 500);
/** Ảnh nhỏ hơn mức này được đọc vào bộ nhớ để tạo thumbnail */
const THUMB_MAX_BYTES = 40 * 1024 * 1024;

const error = (message: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error: message }, { status, headers });

/**
 * Xác định người upload và mặt hàng:
 *  - ?t=up_…              → link upload ngắn hạn do agent xin qua MCP (create_upload_url), cố định mặt hàng;
 *  - Authorization Bearer → API token quyền ghi (script);
 *  - còn lại              → cookie phiên đăng nhập (giao diện web).
 */
async function resolveUploader(req: NextRequest): Promise<{ userId: string; itemId: number } | NextResponse> {
  const linkToken = req.nextUrl.searchParams.get("t");
  if (linkToken) {
    const link = await consumeUploadLink(linkToken);
    if (!link) return error("Link upload không hợp lệ, đã hết hạn hoặc hết lượt — xin link mới bằng create_upload_url", 401);
    return link;
  }

  const itemId = Number(req.nextUrl.searchParams.get("itemId"));
  if (!Number.isInteger(itemId) || itemId <= 0) return error("itemId không hợp lệ", 400);

  const authorization = req.headers.get("authorization");
  if (authorization) {
    const auth = await verifyBearer(authorization);
    if (!auth) {
      return error("Thiếu hoặc sai API token (Authorization: Bearer inv_…)", 401, {
        "WWW-Authenticate": 'Bearer realm="inventory"',
      });
    }
    if (auth.scope !== "write") return error("Token này chỉ có quyền đọc (scope=read)", 403);
    return { userId: auth.userId, itemId };
  }
  const me = await getCurrentUser();
  if (!me) return error("Chưa đăng nhập", 401);
  return { userId: me.id, itemId };
}

/**
 * Upload 1 file thô (body = nội dung file).
 *   POST /api/media/upload?itemId=1&filename=abc.jpg[&cover=1]     (cookie web hoặc Bearer token)
 *   POST /api/media/upload?t=up_…&filename=abc.jpg[&cover=1]       (link upload của agent)
 * Content-Type = loại file; nếu thiếu / chung chung thì đoán theo đuôi filename.
 */
export async function POST(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename") || "file";
  const setCover = ["1", "true"].includes(req.nextUrl.searchParams.get("cover") ?? "");
  const contentType = resolveContentType(req.headers.get("content-type"), filename);
  const sizeHeader = Number(req.headers.get("content-length") || 0);

  if (!req.body || req.headers.get("content-length") === "0") return error("File rỗng", 400);
  if (sizeHeader > MAX_MB * 1024 * 1024) return error(`File vượt quá ${MAX_MB}MB`, 413);

  const who = await resolveUploader(req);
  if (who instanceof NextResponse) return who;

  try {
    const bufferIt = mediaKindOf(contentType) === "image" && sizeHeader > 0 && sizeHeader <= THUMB_MAX_BYTES;
    const body = bufferIt
      ? Buffer.from(await req.arrayBuffer())
      : Readable.fromWeb(req.body as unknown as NodeWebStream);
    const row = await addItemMediaFor(who.userId, who.itemId, {
      body,
      size: sizeHeader || undefined,
      filename,
      contentType,
      setCover,
    });
    revalidatePath("/", "layout");
    return NextResponse.json({ media: row });
  } catch (err) {
    if (err instanceof MediaStorageError) return error(err.message, 502);
    if (err instanceof InventoryError) return error(err.message, 404);
    console.error("[upload]", err);
    return error("Có lỗi xảy ra, vui lòng thử lại", 500);
  }
}
