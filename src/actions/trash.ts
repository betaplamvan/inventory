"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { pgErrorMessage } from "@/lib/inventory/mutations";
import { purgeTrashFor, restoreItemFor } from "@/lib/inventory/trash";

export type RestoreResult = { ok: false; error: string };

/**
 * Khôi phục rồi mở luôn mặt hàng (dòng trong thùng rác biến mất nên không hiện kết quả tại chỗ được).
 * ?restored=1, kèm skuCleared nếu SKU cũ đã bị mặt hàng khác dùng → trang mặt hàng hiện thông báo.
 */
export async function restoreItem(id: number, _prev: RestoreResult | null): Promise<RestoreResult> {
  const me = await requireUser();
  let res;
  try {
    res = await restoreItemFor(me.id, id);
  } catch (err) {
    return { ok: false, error: pgErrorMessage(err) };
  }
  revalidatePath("/", "layout");
  const q = new URLSearchParams({ restored: "1", ...(res.skuCleared ? { skuCleared: res.skuCleared } : {}) });
  redirect(`/items/${res.id}?${q}`);
}

/** Xoá hẳn 1 món trong thùng rác (cả ảnh / video và lịch sử). */
export async function purgeItem(id: number) {
  const me = await requireUser();
  await purgeTrashFor(me.id, [id]);
  revalidatePath("/", "layout");
}

export async function emptyTrash() {
  const me = await requireUser();
  await purgeTrashFor(me.id, "all");
  revalidatePath("/", "layout");
}
