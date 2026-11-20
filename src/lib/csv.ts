/** Đọc / ghi CSV thuần (không phụ thuộc server) — dùng cho xuất, nhập và file mẫu. */

export function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM để Excel đọc đúng UTF-8 tiếng Việt */
export const toCsv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

/** Đoán dấu phân cách từ dòng đầu: tab (dán từ Excel / Google Sheets), chấm phẩy (Excel bản tiếng Việt) hoặc phẩy. */
function detectDelimiter(text: string) {
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  if (counts["\t"] > 0 && counts["\t"] >= counts[","] && counts["\t"] >= counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/**
 * Tách CSV / TSV thành các dòng ô (hỗ trợ ô trong ngoặc kép có dấu phẩy, xuống dòng, "" = dấu ngoặc kép).
 * Bỏ BOM và các dòng trống hoàn toàn. Mỗi phần tử kèm số dòng trong file gốc (bắt đầu từ 1).
 */
export function parseCsv(input: string): { line: number; cells: string[] }[] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells: cells.map((c) => c.trim()) });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length) endRow();
  return rows;
}
