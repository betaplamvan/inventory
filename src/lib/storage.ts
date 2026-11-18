import "server-only";
import { Client } from "minio";
import type { Readable } from "node:stream";

const globalForMinio = globalThis as unknown as {
  minio?: Client;
  bucketReady?: Promise<void>;
};

export const BUCKET = process.env.MINIO_BUCKET || "inventory";

export const minio =
  globalForMinio.minio ??
  new Client({
    endPoint: process.env.MINIO_ENDPOINT || "localhost",
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin123",
  });

if (process.env.NODE_ENV !== "production") globalForMinio.minio = minio;

/** Tạo bucket nếu chưa có (chỉ chạy 1 lần mỗi process). */
export function ensureBucket(): Promise<void> {
  if (!globalForMinio.bucketReady) {
    globalForMinio.bucketReady = (async () => {
      const exists = await minio.bucketExists(BUCKET);
      if (!exists) await minio.makeBucket(BUCKET);
    })().catch((err) => {
      globalForMinio.bucketReady = undefined;
      throw err;
    });
  }
  return globalForMinio.bucketReady;
}

export async function putObject(
  key: string,
  body: Buffer | Readable,
  size: number | undefined,
  contentType: string,
) {
  await ensureBucket();
  await minio.putObject(BUCKET, key, body, size, { "Content-Type": contentType });
}

export async function statObject(key: string) {
  return minio.statObject(BUCKET, key);
}

export async function getObject(key: string, range?: { start: number; end: number }) {
  if (range) {
    return minio.getPartialObject(BUCKET, key, range.start, range.end - range.start + 1);
  }
  return minio.getObject(BUCKET, key);
}

export async function removeObjects(keys: (string | null | undefined)[]) {
  const list = keys.filter((k): k is string => !!k);
  if (list.length === 0) return;
  try {
    await minio.removeObjects(BUCKET, list);
  } catch (err) {
    console.error("[storage] removeObjects failed", err);
  }
}
