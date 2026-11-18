import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { items, media } from "@/db/schema";
import { putObject } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth/session";

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 500);
/** Ảnh nhỏ hơn mức này được đọc vào bộ nhớ để tạo thumbnail */
const THUMB_MAX_BYTES = 40 * 1024 * 1024;

function kindOf(contentType: string) {
  if (contentType.startsWith("image/")) return "image" as const;
  if (contentType.startsWith("video/")) return "video" as const;
  return "file" as const;
}

/**
 * Upload 1 file thô (body = nội dung file).
 * POST /api/media/upload?itemId=1&filename=abc.jpg   (header Content-Type = loại file)
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const itemId = Number(req.nextUrl.searchParams.get("itemId"));
  const filename = (req.nextUrl.searchParams.get("filename") || "file").slice(0, 255);
  const contentType = (req.headers.get("content-type") || "application/octet-stream").split(";")[0];
  const sizeHeader = Number(req.headers.get("content-length") || 0);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "itemId không hợp lệ" }, { status: 400 });
  }
  if (!req.body) return NextResponse.json({ error: "File rỗng" }, { status: 400 });
  if (sizeHeader > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File vượt quá ${MAX_MB}MB` }, { status: 413 });
  }

  const [item] = await db
    .select({ id: items.id, cover: items.coverMediaId })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, me.id)));
  if (!item) return NextResponse.json({ error: "Không tìm thấy mặt hàng" }, { status: 404 });

  const kind = kindOf(contentType);
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  const key = `items/${itemId}/${randomUUID()}${ext}`;
  let thumbKey: string | null = null;
  let size = sizeHeader;

  try {
    if (kind === "image" && sizeHeader > 0 && sizeHeader <= THUMB_MAX_BYTES) {
      const buf = Buffer.from(await req.arrayBuffer());
      size = buf.length;
      await putObject(key, buf, buf.length, contentType);
      try {
        const thumb = await sharp(buf)
          .rotate()
          .resize(480, 480, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        thumbKey = `${key}.thumb.webp`;
        await putObject(thumbKey, thumb, thumb.length, "image/webp");
      } catch (err) {
        console.warn("[upload] không tạo được thumbnail:", (err as Error).message);
        thumbKey = null;
      }
    } else {
      const stream = Readable.fromWeb(req.body as unknown as NodeWebStream);
      await putObject(key, stream, sizeHeader || undefined, contentType);
    }
  } catch (err) {
    console.error("[upload] lỗi MinIO", err);
    return NextResponse.json(
      { error: "Không lưu được file vào MinIO. Kiểm tra MinIO đã chạy chưa." },
      { status: 502 },
    );
  }

  const [row] = await db
    .insert(media)
    .values({
      itemId,
      objectKey: key,
      thumbKey,
      filename,
      contentType,
      size,
      kind,
      sortOrder: sql`coalesce((select max(${media.sortOrder}) + 1 from ${media} where ${media.itemId} = ${itemId}), 0)`,
    })
    .returning();

  if (kind === "image" && item.cover == null) {
    await db.update(items).set({ coverMediaId: row.id }).where(eq(items.id, itemId));
  }

  revalidatePath("/", "layout");
  return NextResponse.json({ media: row });
}
