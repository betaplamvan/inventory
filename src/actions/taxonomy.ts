"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, locations } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { parentProblem } from "@/lib/inventory/mutations";
import { currentDomain } from "@/lib/domain-server";
import { DOMAIN_CONFIG } from "@/lib/domains";
import type { ActionResult } from "./items";

type Table = typeof categories | typeof locations;

function readCommon(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  const parentRaw = Number(fd.get("parentId"));
  const parentId = Number.isInteger(parentRaw) && parentRaw > 0 ? parentRaw : null;
  const description = String(fd.get("description") ?? "").trim() || null;
  return { name, parentId, description };
}

async function save(table: Table, id: number | null, fd: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const { name, parentId, description } = readCommon(fd);
  if (!name) return { ok: false, error: "Vui lòng nhập tên" };

  // Sửa: giữ kho của mục; thêm mới: kho đang chọn
  let domain = await currentDomain();
  if (id != null) {
    const [row] = await db
      .select({ domain: table.domain })
      .from(table)
      .where(and(eq(table.id, id), eq(table.userId, me.id)));
    if (!row) return { ok: false, error: "Không tìm thấy" };
    domain = row.domain;
  }
  const problem = await parentProblem(table, me.id, id, parentId, domain);
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
    await db.insert(table).values({ name, parentId, description, userId: me.id, domain, ...extra });
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

/** Tạo sẵn bộ danh mục phổ biến của kho đang chọn (chỉ khi kho đó chưa có danh mục nào) */
export async function seedDefaultCategories() {
  const me = await requireUser();
  const domain = await currentDomain();
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, me.id), eq(categories.domain, domain)))
    .limit(1);
  if (existing.length) return;
  await db.transaction(async (tx) => {
    for (const [i, [name, children]] of DOMAIN_CONFIG[domain].categoryPresets.entries()) {
      const [parent] = await tx
        .insert(categories)
        .values({ name, sortOrder: i, userId: me.id, domain })
        .returning({ id: categories.id });
      if (children.length) {
        await tx
          .insert(categories)
          .values(children.map((c, j) => ({ name: c, parentId: parent.id, sortOrder: j, userId: me.id, domain })));
      }
    }
  });
  revalidatePath("/", "layout");
}

/** Tạo sẵn vị trí cất phổ biến của kho đang chọn (tủ lạnh / ngăn đá, tủ quần áo / kệ giày…) */
export async function seedDefaultLocations() {
  const me = await requireUser();
  const domain = await currentDomain();
  const existing = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.userId, me.id), eq(locations.domain, domain)))
    .limit(1);
  if (existing.length) return;
  await db.transaction(async (tx) => {
    for (const [name, children] of DOMAIN_CONFIG[domain].locationPresets) {
      const [parent] = await tx
        .insert(locations)
        .values({ name, userId: me.id, domain })
        .returning({ id: locations.id });
      if (children.length) {
        await tx.insert(locations).values(children.map((c) => ({ name: c, parentId: parent.id, userId: me.id, domain })));
      }
    }
  });
  revalidatePath("/", "layout");
}
