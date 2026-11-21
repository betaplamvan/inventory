import "server-only";
import type { Domain } from "@/db/schema";
import { normalizeText } from "@/lib/format";
import { getCategoryTree, getLocationTree } from "@/lib/queries";
import { InventoryError, createCategoryFor, createLocationFor } from "./mutations";

/**
 * Tham chiếu danh mục / vị trí bằng id hoặc tên / đường dẫn ("Tụ điện > Tụ gốm").
 * Dùng chung cho tool MCP và nhập CSV. Chạy trong ngữ cảnh của user hiện tại (cookie hoặc runAsUser).
 */

type Tree = { id: number; name: string; parentId: number | null; path: string }[];

/** Không có danh mục / vị trí khớp tên (khác với lỗi tên bị trùng hay id sai) */
export class RefNotFoundError extends InventoryError {}

export const splitPath = (s: string) =>
  s
    .split(/\s*(?:›|>|\/)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

export async function resolveRef(
  kind: "category" | "location",
  ref: number | string | null | undefined,
  userId: string,
  createMissing: boolean,
  /** Kho của mặt hàng: chỉ tìm / tạo danh mục, vị trí trong kho này */
  domain: Domain,
): Promise<number | null> {
  if (ref == null || ref === "") return null;
  const tree: Tree = kind === "category" ? await getCategoryTree(domain) : await getLocationTree(domain);
  const label = kind === "category" ? "danh mục" : "vị trí";

  if (typeof ref === "number") {
    if (!tree.some((n) => n.id === ref)) throw new InventoryError(`Không có ${label} id=${ref}`);
    return ref;
  }

  const wanted = splitPath(ref).map(normalizeText);
  if (!wanted.length) return null;
  const wantedPath = wanted.join(" > ");
  const byPath = tree.filter((n) => splitPath(n.path).map(normalizeText).join(" > ") === wantedPath);
  if (byPath.length === 1) return byPath[0].id;

  if (wanted.length === 1) {
    const byName = tree.filter((n) => normalizeText(n.name) === wanted[0]);
    if (byName.length === 1) return byName[0].id;
    if (byName.length > 1) {
      throw new InventoryError(
        `Tên ${label} "${ref}" bị trùng, hãy dùng id hoặc đường dẫn đầy đủ: ${byName.map((n) => `${n.id}: ${n.path}`).join("; ")}`,
      );
    }
  }

  if (!createMissing) {
    throw new RefNotFoundError(
      `Không tìm thấy ${label} "${ref}". Gọi list_${kind === "category" ? "categories" : "locations"} để xem danh sách, ` +
        `hoặc truyền createMissing=true để tự tạo.`,
    );
  }

  // Tạo lần lượt từng cấp của đường dẫn còn thiếu
  const parts = splitPath(ref);
  let parentId: number | null = null;
  let current = tree;
  for (const part of parts) {
    const found = current.find((n) => n.parentId === parentId && normalizeText(n.name) === normalizeText(part));
    if (found) {
      parentId = found.id;
      continue;
    }
    parentId =
      kind === "category"
        ? await createCategoryFor(userId, { domain, name: part, parentId })
        : await createLocationFor(userId, { domain, name: part, parentId });
    current = kind === "category" ? await getCategoryTree(domain) : await getLocationTree(domain);
  }
  return parentId;
}
