const numberFmt = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const dateTimeFmt = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function fmtQty(n: number | null | undefined) {
  return numberFmt.format(n ?? 0);
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return `${moneyFmt.format(n)} ₫`;
}

export function fmtDateTime(d: Date | string) {
  return dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
}

export function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Bỏ dấu tiếng Việt + chữ thường, dùng cho tìm kiếm. */
export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
