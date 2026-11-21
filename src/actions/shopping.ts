"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { currentDomain } from "@/lib/domain-server";
import { parseNum } from "@/lib/item-input";
import { pgErrorMessage } from "@/lib/inventory/mutations";
import { addShoppingFor, clearDoneShoppingFor, removeShoppingFor, setShoppingDoneFor } from "@/lib/inventory/shopping";

export type ShoppingState = { ok?: boolean; error?: string } | null;

const refresh = () => revalidatePath("/", "layout");

/** Thêm 1 món vào danh sách cần mua của kho đang chọn */
export async function addShopping(_prev: ShoppingState, fd: FormData): Promise<ShoppingState> {
  const me = await requireUser();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Nhập tên món cần mua" };
  const q = parseNum(fd.get("quantity"));
  if (q != null && (Number.isNaN(q) || q < 0)) return { error: "Số lượng không hợp lệ" };
  try {
    await addShoppingFor(me.id, await currentDomain(), [
      {
        name,
        quantity: q,
        unit: String(fd.get("unit") ?? "").trim() || null,
        note: String(fd.get("note") ?? "").trim() || null,
      },
    ]);
  } catch (err) {
    return { error: pgErrorMessage(err) };
  }
  refresh();
  return { ok: true };
}

/** Món dưới mức tối thiểu → thêm vào danh sách (gắn mặt hàng, số lượng = bù tới mức tối thiểu) */
export async function addLowStockToShopping(item: { id: number; name: string; quantity: number; unit: string }) {
  const me = await requireUser();
  await addShoppingFor(me.id, await currentDomain(), [
    { name: item.name, itemId: item.id, quantity: item.quantity > 0 ? item.quantity : null, unit: item.unit },
  ]);
  refresh();
}

/** Đánh dấu đã mua / chưa mua; stockIn: nhập kho luôn vào mặt hàng gắn kèm */
export async function toggleShopping(id: number, done: boolean, stockIn = false) {
  const me = await requireUser();
  await setShoppingDoneFor(me.id, id, done, { stockIn });
  refresh();
}

export async function deleteShopping(id: number) {
  const me = await requireUser();
  await removeShoppingFor(me.id, [id]);
  refresh();
}

export async function clearDoneShopping() {
  const me = await requireUser();
  await clearDoneShoppingFor(me.id, await currentDomain());
  refresh();
}
