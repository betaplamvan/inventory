import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { items, media, type Media } from "@/db/schema";
import { putObject } from "@/lib/storage";
import { InventoryError } from "./mutations";

/**
 * Lưu ảnh / video / tài liệu của mặt hàng lên MinIO + ghi bản ghi media.
 * Dùng chung cho route upload (cookie web, Bearer token, link upload của agent).
 */

/** Lỗi lưu MinIO — route trả 502 thay vì 400 */
export class MediaStorageError extends InventoryError {}

export function mediaKindOf(contentType: string) {
  if (contentType.startsWith("image/")) return "image" as const;
  if (contentType.startsWith("video/")) return "video" as const;
  return "file" as const;
}

export type AddMediaInput = {
  /** Buffer → nếu là ảnh sẽ tạo thumbnail; stream → lưu thẳng (video, file lớn) */
  body: Buffer | Readable;
  /** Bắt buộc khi body là stream (MinIO cần để upload 1 lần); có thể bỏ trống nếu không biết */
  size?: number;
  filename: string;
  contentType: string;
  /** true → đặt làm ảnh đại diện. Mặc định: chỉ đặt nếu mặt hàng chưa có ảnh đại diện */
  setCover?: boolean;
};

export async function addItemMediaFor(userId: string, itemId: number, input: AddMediaInput): Promise<Media> {
  const [item] = await db
    .select({ id: items.id, cover: items.coverMediaId })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId)));
  if (!item) throw new InventoryError(`Không có mặt hàng id=${itemId}`);

  const filename = (input.filename || "file").slice(0, 255);
  const contentType = input.contentType.split(";")[0].trim() || "application/octet-stream";
  const kind = mediaKindOf(contentType);
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  const key = `items/${itemId}/${randomUUID()}${ext}`;
  let thumbKey: string | null = null;
  let size = input.size ?? 0;

  try {
    if (Buffer.isBuffer(input.body)) {
      const buf = input.body;
      size = buf.length;
      await putObject(key, buf, buf.length, contentType);
      if (kind === "image") thumbKey = await makeThumbnail(key, buf);
    } else {
      await putObject(key, input.body, input.size || undefined, contentType);
    }
  } catch (err) {
    console.error("[media] lỗi MinIO", err);
    throw new MediaStorageError("Không lưu được file vào MinIO. Kiểm tra MinIO đã chạy chưa.");
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

  if (kind === "image" && (input.setCover || item.cover == null)) {
    await db.update(items).set({ coverMediaId: row.id }).where(eq(items.id, itemId));
  }
  return row;
}

async function makeThumbnail(key: string, buf: Buffer) {
  try {
    const thumb = await sharp(buf)
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const thumbKey = `${key}.thumb.webp`;
    await putObject(thumbKey, thumb, thumb.length, "image/webp");
    return thumbKey;
  } catch (err) {
    console.warn("[media] không tạo được thumbnail:", (err as Error).message);
    return null;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain",
};

/** Header thường gặp khi client không biết loại file (vd. curl --data-binary mặc định gửi form-urlencoded) */
const GENERIC_TYPES = new Set(["", "application/octet-stream", "application/x-www-form-urlencoded", "multipart/form-data"]);

/** Loại file: dùng Content-Type nếu cụ thể, không thì đoán theo đuôi tên file. */
export function resolveContentType(header: string | null, filename: string) {
  const ct = (header ?? "").split(";")[0].trim().toLowerCase();
  if (!GENERIC_TYPES.has(ct)) return ct;
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}
