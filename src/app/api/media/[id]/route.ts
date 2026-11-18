import { Readable } from "node:stream";
import { type NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, media } from "@/db/schema";
import { getObject, statObject } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Stream file từ MinIO qua Next (không cần public MinIO ra ngoài).
 * Hỗ trợ header Range để tua video.
 *   /api/media/12            -> file gốc
 *   /api/media/12?thumb=1    -> thumbnail (nếu có)
 *   /api/media/12?download=1 -> tải về
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[id]">) {
  const me = await getCurrentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const mediaId = Number(id);
  if (!Number.isInteger(mediaId)) return new NextResponse("Not found", { status: 404 });

  // Chỉ chủ của mặt hàng mới xem được file
  const [row] = await db
    .select({ m: media })
    .from(media)
    .innerJoin(items, eq(items.id, media.itemId))
    .where(and(eq(media.id, mediaId), eq(items.userId, me.id)));
  const m = row?.m;
  if (!m) return new NextResponse("Not found", { status: 404 });

  const wantThumb = req.nextUrl.searchParams.has("thumb") && m.thumbKey;
  const key = wantThumb ? m.thumbKey! : m.objectKey;
  const contentType = wantThumb ? "image/webp" : m.contentType;

  let size: number;
  try {
    size = (await statObject(key)).size;
  } catch {
    return new NextResponse("File không còn trong kho lưu trữ", { status: 404 });
  }

  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(m.filename)}`,
  });

  const range = req.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && size > 0) {
    let start = match[1] ? Number(match[1]) : NaN;
    let end = match[2] ? Number(match[2]) : NaN;
    if (Number.isNaN(start)) {
      // bytes=-500 : 500 byte cuối
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end));
      end = size - 1;
    } else if (Number.isNaN(end) || end >= size) {
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = await getObject(key, { start, end });
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }

  const stream = await getObject(key);
  headers.set("Content-Length", String(size));
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}
