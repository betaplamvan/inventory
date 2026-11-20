"use server";

import { revalidatePath } from "next/cache";
import { runAsUser } from "@/lib/auth/actor";
import { requireUser } from "@/lib/auth/session";
import { csvToRows, importRows, type CsvColumn, type ImportResult } from "@/lib/inventory/import";
import { pgErrorMessage } from "@/lib/inventory/mutations";

/** Giới hạn nội dung dán / file (ký tự) — khớp với serverActions.bodySizeLimit trong next.config.ts */
const MAX_CHARS = 2_000_000;

export type ImportState =
  | { ok: true; done: boolean; columns: CsvColumn[]; result: ImportResult }
  | { ok: false; error: string; columns?: CsvColumn[] };

/**
 * Xem trước (commit=false: chỉ kiểm tra, không ghi gì) hoặc nhập thật (commit=true).
 * Dòng lỗi không chặn các dòng khác: dòng nào hợp lệ thì vẫn được nhập.
 */
export async function importCsv(
  text: string,
  opts: { onExisting: "update" | "skip"; createMissing: boolean; commit: boolean },
): Promise<ImportState> {
  const me = await requireUser();
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Chưa có dữ liệu để nhập." };
  if (text.length > MAX_CHARS) return { ok: false, error: "Dữ liệu quá lớn (tối đa khoảng 2MB mỗi lần)." };

  const { rows, columns, error } = csvToRows(text);
  if (error) return { ok: false, error, columns };

  try {
    // runAsUser: ghi nguồn "import" vào lịch sử nhập/xuất của các dòng có đổi số lượng
    const result = await runAsUser(
      me.id,
      () =>
        importRows(me.id, rows, {
          onExisting: opts.onExisting === "skip" ? "skip" : "update",
          createMissing: !!opts.createMissing,
          dryRun: !opts.commit,
        }),
      { source: "import" },
    );
    if (opts.commit) revalidatePath("/", "layout");
    return { ok: true, done: !!opts.commit, columns, result };
  } catch (err) {
    return { ok: false, error: pgErrorMessage(err), columns };
  }
}
