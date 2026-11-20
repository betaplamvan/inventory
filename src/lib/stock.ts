/** Tình trạng tồn kho: hết / sắp hết (≤ mức tối thiểu, nếu có đặt) / đủ. Dùng được ở cả server và client. */
export type StockState = "ok" | "low" | "out";

export function stockState(quantity: number, minQuantity: number): StockState {
  if (quantity <= 0) return "out";
  if (minQuantity > 0 && quantity <= minQuantity) return "low";
  return "ok";
}

/** Mức độ nghiêm trọng, để so sánh "tệ hơn trước" */
export const STOCK_SEVERITY: Record<StockState, number> = { ok: 0, low: 1, out: 2 };
