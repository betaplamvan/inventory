import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { BUCKET, ensureBucket } from "./storage";

/** Áp dụng migration (thư mục ./drizzle) và tạo bucket MinIO nếu chưa có. */
export async function startup() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("[startup] database đã cập nhật");
  } catch (err) {
    console.error("[startup] lỗi migrate database:", (err as Error).message);
  } finally {
    await client.end();
  }

  try {
    await ensureBucket();
    console.log(`[startup] MinIO bucket "${BUCKET}" sẵn sàng`);
  } catch (err) {
    console.error("[startup] không kết nối được MinIO:", (err as Error).message);
  }
}
