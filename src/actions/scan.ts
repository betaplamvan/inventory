"use server";

import { requireUser } from "@/lib/auth/session";
import { findItemsByCode, findLocationByCode, getItem, getLocation } from "@/lib/queries";

export type ScanResult =
  | { ok: true; href: string; label: string }
  | { ok: false; error: string };

/**
 * Mã quét được → trang cần mở:
 *  - nhãn của app (…/s/i/<id>, …/s/l/<id>, host nào cũng được) → mặt hàng / danh sách hàng ở vị trí đó;
 *  - SKU hoặc MPN trùng khớp → mặt hàng;
 *  - mã vị trí (nhãn dán "A1-03") → danh sách hàng ở vị trí đó;
 *  - còn lại → tìm trong kho theo nội dung mã.
 * Nhãn túi LCSC ({pc:C7171,pm:TL431,…}) được tách lấy MPN.
 */
export async function resolveScan(raw: string): Promise<ScanResult> {
  await requireUser();
  const text = String(raw ?? "").trim().slice(0, 500);
  if (!text) return { ok: false, error: "Mã trống" };

  const own = text.match(/\/s\/([il])\/(\d{1,9})(?:[/?#]|$)/);
  if (own) {
    const id = Number(own[2]);
    if (own[1] === "i") {
      const item = await getItem(id);
      return item
        ? { ok: true, href: `/items/${item.id}`, label: item.name }
        : { ok: false, error: "Nhãn này trỏ tới mặt hàng không còn trong kho (đã xoá hoặc thuộc tài khoản khác)." };
    }
    const loc = await getLocation(id);
    return loc
      ? { ok: true, href: `/items?location=${loc.id}`, label: `Vị trí: ${loc.name}` }
      : { ok: false, error: "Nhãn này trỏ tới vị trí không còn tồn tại." };
  }

  // Nhãn LCSC: {pbn:…,on:…,pc:C7171,pm:TL431ACLPR,qty:100,…}
  const lcsc = text.match(/[{,]pm:([^,}]+)/)?.[1]?.trim();
  const code = lcsc || text;

  // Link ngoài (QR của hãng, trang sản phẩm…) thì không đem đi tìm
  if (/^https?:\/\//i.test(code)) return { ok: false, error: "Mã này là một đường link ngoài, không phải nhãn của kho." };

  const matches = await findItemsByCode(code);
  if (matches.length === 1) return { ok: true, href: `/items/${matches[0].id}`, label: matches[0].name };

  if (!matches.length) {
    const loc = await findLocationByCode(code);
    if (loc) return { ok: true, href: `/items?location=${loc.id}`, label: `Vị trí: ${loc.name}` };
  }

  return { ok: true, href: `/items?q=${encodeURIComponent(code)}`, label: `Tìm "${code}"` };
}
