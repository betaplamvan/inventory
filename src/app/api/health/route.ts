import { NextResponse, connection } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Healthcheck cho Docker / script deploy: 200 khi kết nối được Postgres. */
export async function GET() {
  await connection();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health] database lỗi:", (err as Error).message);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
