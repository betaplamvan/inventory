"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, locations } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import type { ActionResult } from "./items";

type Table = typeof categories | typeof locations;

function readCommon(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  const parentRaw = Number(fd.get("parentId"));
  const parentId = Number.isInteger(parentRaw) && parentRaw > 0 ? parentRaw : null;
  const description = String(fd.get("description") ?? "").trim() || null;
  return { name, parentId, description };
}

/** Kiểm tra mục cha thuộc user và không tạo vòng lặp cha-con */
async function parentProblem(table: Table, userId: string, id: number | null, parentId: number | null) {
  if (parentId == null) return null;
  const rows = await db
    .select({ id: table.id, parentId: table.parentId })
    .from(table)
    .where(eq(table.userId, userId));
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  if (!parentOf.has(parentId)) return "Mục cha không hợp lệ";
  if (id == null) return null;
  let cur: number | null | undefined = parentId;
  let guard = 0;
  while (cur != null && guard++ < 100) {
    if (cur === id) return "Không thể chọn chính nó hoặc mục con làm mục cha";
    cur = parentOf.get(cur);
  }
  return null;
}

async function save(table: Table, id: number | null, fd: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const { name, parentId, description } = readCommon(fd);
  if (!name) return { ok: false, error: "Vui lòng nhập tên" };

  const problem = await parentProblem(table, me.id, id, parentId);
  if (problem) return { ok: false, error: problem };

  const extra: Record<string, unknown> =
    table === locations
      ? { code: String(fd.get("code") ?? "").trim() || null }
      : { sortOrder: Number(fd.get("sortOrder")) || 0 };

  if (id != null) {
    const updated = await db
      .update(table)
      .set({ name, parentId, description, ...extra })
      .where(and(eq(table.id, id), eq(table.userId, me.id)))
      .returning({ id: table.id });
    if (!updated.length) return { ok: false, error: "Không tìm thấy" };
  } else {
    await db.insert(table).values({ name, parentId, description, userId: me.id, ...extra });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveCategory(id: number | null, _prev: ActionResult | null, fd: FormData) {
  return save(categories, id, fd);
}

export async function saveLocation(id: number | null, _prev: ActionResult | null, fd: FormData) {
  return save(locations, id, fd);
}

export async function deleteCategory(id: number) {
  const me = await requireUser();
  await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, me.id)));
  revalidatePath("/", "layout");
}

export async function deleteLocation(id: number) {
  const me = await requireUser();
  await db.delete(locations).where(and(eq(locations.id, id), eq(locations.userId, me.id)));
  revalidatePath("/", "layout");
}

const DEFAULT_CATEGORIES: [string, string[]][] = [
  ["Điện trở", ["Điện trở cắm (THT)", "Điện trở dán (SMD)", "Biến trở / Triết áp"]],
  ["Tụ điện", ["Tụ gốm", "Tụ hoá", "Tụ tantalum", "Tụ film"]],
  ["Cuộn cảm & Biến áp", []],
  ["Diode", ["Diode chỉnh lưu", "Diode zener", "Diode schottky", "LED"]],
  ["Transistor", ["BJT", "MOSFET", "IGBT / Triac / SCR"]],
  ["IC", ["Vi điều khiển", "IC nguồn / ổn áp", "Op-amp", "IC logic", "IC driver", "IC nhớ"]],
  ["Module", ["Module cảm biến", "Module truyền thông", "Module nguồn", "Màn hình", "Board phát triển"]],
  ["Đầu nối & Dây", ["Header / Jumper", "Terminal", "Jack / USB", "Dây điện"]],
  ["Công tắc & Nút nhấn", []],
  ["Relay", []],
  ["Thạch anh & Dao động", []],
  ["Cầu chì & Bảo vệ", []],
  ["Pin & Nguồn", []],
  ["Cơ khí", ["Ốc vít / Trụ đồng", "Vỏ hộp", "Quạt / Tản nhiệt"]],
  ["Dụng cụ", ["Dụng cụ hàn", "Dụng cụ đo", "Dụng cụ cắt / kìm", "Dụng cụ khác"]],
  ["Vật tư tiêu hao", ["Thiếc hàn", "Nhựa thông / Flux", "Băng keo / Ống co nhiệt", "Phíp đồng / PCB"]],
];

export async function seedDefaultCategories() {
  const me = await requireUser();
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, me.id))
    .limit(1);
  if (existing.length) return;
  await db.transaction(async (tx) => {
    for (const [i, [name, children]] of DEFAULT_CATEGORIES.entries()) {
      const [parent] = await tx
        .insert(categories)
        .values({ name, sortOrder: i, userId: me.id })
        .returning({ id: categories.id });
      if (children.length) {
        await tx
          .insert(categories)
          .values(children.map((c, j) => ({ name: c, parentId: parent.id, sortOrder: j, userId: me.id })));
      }
    }
  });
  revalidatePath("/", "layout");
}
