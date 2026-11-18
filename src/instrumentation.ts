/**
 * Chạy 1 lần khi server Next khởi động:
 *  - áp dụng migration database (thư mục ./drizzle)
 *  - tạo bucket MinIO nếu chưa có
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SKIP_STARTUP_MIGRATE !== "true") {
    const { startup } = await import("./lib/startup");
    await startup();
  }
}
