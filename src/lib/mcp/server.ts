import "server-only";
import { revalidatePath } from "next/cache";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { categories, items } from "@/db/schema";
import { runAsUser } from "@/lib/auth/actor";
import { appBaseUrl } from "@/lib/auth/constants";
import type { TokenScope } from "@/lib/auth/api-tokens";
import { ITEM_KINDS, KIND_LABELS, MOVEMENT_LABELS } from "@/lib/constants";
import { normalizeText } from "@/lib/format";
import { itemSchema, type ItemInput } from "@/lib/item-input";
import {
  InventoryError,
  createCategoryFor,
  createItemFor,
  createLocationFor,
  pgErrorMessage,
  recordMovementFor,
  updateItemFor,
} from "@/lib/inventory/mutations";
import {
  getCategoryTree,
  getDashboard,
  getItem,
  getItemMovements,
  getLocationTree,
  listItems,
  listMovements,
  type SortKey,
  type StockFilter,
} from "@/lib/queries";
import { UPLOAD_LINK_MAX_FILES, UPLOAD_LINK_MAX_MINUTES, createUploadLink } from "@/lib/inventory/upload-links";
import { MEDIA_LINK_DAYS, createMediaLink } from "@/lib/inventory/media-links";
import { getObject } from "@/lib/storage";

export type McpAuth = { userId: string; scope: TokenScope; tokenId?: string };

/** get_item_images: số ảnh tối đa được cấp URL trong một lần gọi */
const MAX_IMAGE_URLS = 20;

const json = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const itemUrl = (id: number) => `${appBaseUrl()}/items/${id}`;

/* ------------------------------------------------------------------ */
/* Tham chiếu danh mục / vị trí bằng id hoặc tên / đường dẫn           */
/* ------------------------------------------------------------------ */

const refSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe('id (số) hoặc tên / đường dẫn, ví dụ "Tụ gốm" hoặc "Tụ điện > Tụ gốm"');

type Tree = { id: number; name: string; parentId: number | null; path: string }[];

const splitPath = (s: string) =>
  s
    .split(/\s*(?:›|>|\/)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

async function resolveRef(
  kind: "category" | "location",
  ref: number | string | null | undefined,
  userId: string,
  createMissing: boolean,
): Promise<number | null> {
  if (ref == null || ref === "") return null;
  const tree: Tree = kind === "category" ? await getCategoryTree() : await getLocationTree();
  const label = kind === "category" ? "danh mục" : "vị trí";

  if (typeof ref === "number") {
    if (!tree.some((n) => n.id === ref)) throw new InventoryError(`Không có ${label} id=${ref}`);
    return ref;
  }

  const wanted = splitPath(ref).map(normalizeText);
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
    throw new InventoryError(
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
        ? await createCategoryFor(userId, { name: part, parentId })
        : await createLocationFor(userId, { name: part, parentId });
    current = kind === "category" ? await getCategoryTree() : await getLocationTree();
  }
  return parentId;
}

/* ------------------------------------------------------------------ */
/* Schema trường mặt hàng                                              */
/* ------------------------------------------------------------------ */

const kindSchema = z
  .enum(ITEM_KINDS as [string, ...string[]])
  .describe(`Loại: ${ITEM_KINDS.map((k) => `${k} = ${KIND_LABELS[k]}`).join(", ")}`);

const itemFields = {
  sku: z.string().max(100).nullish().describe("Mã riêng do người dùng đặt (không trùng trong kho)"),
  kind: kindSchema.optional(),
  category: refSchema.nullish().describe("Danh mục: id hoặc tên / đường dẫn"),
  location: refSchema.nullish().describe("Vị trí cất: id hoặc tên / đường dẫn, ví dụ \"Tủ A > Ngăn 3\""),
  createMissing: z.boolean().optional().describe("true → tự tạo danh mục / vị trí nếu chưa có"),
  manufacturer: z.string().max(200).nullish().describe("Hãng sản xuất"),
  mpn: z.string().max(200).nullish().describe("Mã nhà sản xuất (MPN)"),
  package: z.string().max(100).nullish().describe("Package / kiểu chân, ví dụ DIP-8, SOT-23, 0805"),
  description: z.string().max(10000).nullish(),
  specs: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional()
    .describe('Thông số, ví dụ [{"key":"Điện áp","value":"5V"}]'),
  tags: z.array(z.string()).optional(),
  unit: z.string().max(30).optional().describe('Đơn vị: "cái", "con", "mét", "cuộn"…'),
  minQuantity: z.number().min(0).optional().describe("Mức tối thiểu; thấp hơn sẽ báo cần mua thêm (0 = không theo dõi)"),
  unitPrice: z.number().min(0).nullish().describe("Đơn giá (VNĐ)"),
  supplier: z.string().max(200).nullish().describe("Nhà cung cấp, ví dụ Ban Linh Kiện, Hshop, LCSC"),
  purchaseUrl: z.string().url().nullish().describe("Link mua hàng"),
  datasheetUrl: z.string().url().nullish().describe("Link datasheet"),
  notes: z.string().max(10000).nullish(),
};

function summarizeItem(it: {
  id: number;
  name: string;
  sku: string | null;
  kind: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  unitPrice: number | null;
  package: string | null;
  category?: { name: string } | null;
  location?: { name: string } | null;
}) {
  return {
    id: it.id,
    name: it.name,
    sku: it.sku,
    kind: it.kind,
    quantity: it.quantity,
    unit: it.unit,
    minQuantity: it.minQuantity,
    lowStock: it.minQuantity > 0 && it.quantity <= it.minQuantity,
    unitPrice: it.unitPrice,
    package: it.package,
    category: it.category?.name ?? null,
    location: it.location?.name ?? null,
    url: itemUrl(it.id),
  };
}

async function findItemId(userId: string, ref: { id?: number; sku?: string }) {
  if (ref.id) return ref.id;
  if (ref.sku) {
    const [row] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.sku, ref.sku)));
    if (!row) throw new InventoryError(`Không có mặt hàng SKU "${ref.sku}"`);
    return row.id;
  }
  throw new InventoryError("Cần truyền id hoặc sku");
}

function validateItem(data: unknown): ItemInput {
  const parsed = itemSchema.safeParse(data);
  if (!parsed.success) {
    throw new InventoryError(
      "Dữ liệu không hợp lệ: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

export function buildMcpServer(auth: McpAuth) {
  const server = new McpServer(
    { name: "kho-linh-kien", version: "1.0.0" },
    {
      instructions:
        "Kho linh kiện điện tử cá nhân của người dùng (linh kiện, module, dụng cụ, vật tư). " +
        "Tìm trước bằng search_items để tránh tạo trùng. Thay đổi số lượng bằng record_movement " +
        "(in = nhập thêm, out = lấy ra dùng, adjust = đặt số lượng thực tế khi kiểm kê) để có lịch sử. " +
        "Tiền tệ là VNĐ. Danh mục / vị trí có thể truyền bằng tên, ví dụ \"Tụ điện > Tụ gốm\". " +
        "Gắn ảnh / file: gọi create_upload_url lấy link rồi POST file thẳng lên bằng curl (file không đi qua model).",
    },
  );

  /** Bọc tool: chạy với quyền của chủ token, bắt lỗi nghiệp vụ, chặn ghi nếu token chỉ đọc. */
  const run =
    <A,>(write: boolean, fn: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      if (write && auth.scope !== "write") return fail("Token này chỉ có quyền đọc (scope=read).");
      try {
        const result = await runAsUser(auth.userId, () => fn(args));
        if (write) revalidatePath("/", "layout");
        return result;
      } catch (err) {
        return fail(pgErrorMessage(err));
      }
    };

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const writeHint = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  /* ---------- Đọc ---------- */

  server.registerTool(
    "inventory_overview",
    {
      title: "Tổng quan kho",
      description: "Số mặt hàng, giá trị kho ước tính, số mặt hàng sắp hết / hết, danh sách cần mua thêm, giao dịch gần đây.",
      annotations: readOnly,
    },
    run(false, async () => {
      const d = await getDashboard();
      return json({
        totals: d.totals,
        byKind: d.byKind.map((k) => ({ kind: k.kind, label: KIND_LABELS[k.kind], count: k.n })),
        needToBuy: d.lowStock.map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          minQuantity: it.minQuantity,
          unit: it.unit,
          location: it.location?.name ?? null,
        })),
        recentMovements: d.recent.map(({ movement: m, item }) => ({
          item: item.name,
          itemId: item.id,
          type: MOVEMENT_LABELS[m.type],
          delta: m.delta,
          balanceAfter: m.balanceAfter,
          reference: m.reference,
          at: m.createdAt,
        })),
      });
    }),
  );

  server.registerTool(
    "search_items",
    {
      title: "Tìm mặt hàng",
      description:
        "Tìm / lọc mặt hàng. query tìm theo tên, SKU, MPN, package, tag, thông số (không phân biệt dấu tiếng Việt).",
      inputSchema: {
        query: z.string().optional(),
        category: refSchema.optional().describe("Lọc theo danh mục (gồm cả danh mục con)"),
        location: refSchema.optional().describe("Lọc theo vị trí (gồm cả vị trí con)"),
        kind: kindSchema.optional(),
        stock: z.enum(["all", "in", "low", "out"]).optional().describe("in = còn hàng, low = cần mua thêm, out = hết"),
        sort: z.enum(["updated", "created", "name", "qty", "value"]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Mặc định 20"),
        page: z.number().int().min(1).optional(),
      },
      annotations: readOnly,
    },
    run(false, async (a: {
      query?: string;
      category?: number | string;
      location?: number | string;
      kind?: string;
      stock?: StockFilter;
      sort?: SortKey;
      limit?: number;
      page?: number;
    }) => {
      const res = await listItems({
        q: a.query,
        categoryId: (await resolveRef("category", a.category, auth.userId, false)) ?? undefined,
        locationId: (await resolveRef("location", a.location, auth.userId, false)) ?? undefined,
        kind: a.kind as never,
        stock: a.stock,
        sort: a.sort,
        page: a.page,
        pageSize: a.limit ?? 20,
      });
      return json({
        total: res.total,
        page: res.page,
        pageCount: res.pageCount,
        items: res.rows.map(summarizeItem),
      });
    }),
  );

  server.registerTool(
    "get_item",
    {
      title: "Chi tiết mặt hàng",
      description: "Toàn bộ thông tin một mặt hàng (thông số, link, ảnh/video/tài liệu) và lịch sử nhập/xuất gần đây.",
      inputSchema: {
        id: z.number().int().positive().optional(),
        sku: z.string().optional(),
        movementLimit: z.number().int().min(0).max(100).optional().describe("Số dòng lịch sử, mặc định 20"),
      },
      annotations: readOnly,
    },
    run(false, async (a: { id?: number; sku?: string; movementLimit?: number }) => {
      const id = await findItemId(auth.userId, a);
      const [it, movements, catTree, locTree] = await Promise.all([
        getItem(id),
        getItemMovements(id, a.movementLimit ?? 20),
        getCategoryTree(),
        getLocationTree(),
      ]);
      if (!it) return fail(`Không có mặt hàng id=${id}`);
      return json({
        ...summarizeItem(it),
        category: catTree.find((c) => c.id === it.categoryId)?.path ?? null,
        location: locTree.find((l) => l.id === it.locationId)?.path ?? null,
        categoryId: it.categoryId,
        locationId: it.locationId,
        manufacturer: it.manufacturer,
        mpn: it.mpn,
        description: it.description,
        specs: it.specs,
        tags: it.tags,
        supplier: it.supplier,
        purchaseUrl: it.purchaseUrl,
        datasheetUrl: it.datasheetUrl,
        notes: it.notes,
        media: it.media.map((m) => ({ id: m.id, kind: m.kind, filename: m.filename, size: m.size, isCover: m.id === it.coverMediaId })),
        movements: movements.map((m) => ({
          type: m.type,
          delta: m.delta,
          balanceAfter: m.balanceAfter,
          unitPrice: m.unitPrice,
          reference: m.reference,
          note: m.note,
          at: m.createdAt,
        })),
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      });
    }),
  );

  server.registerTool(
    "get_item_images",
    {
      title: "Xem ảnh mặt hàng",
      description:
        "Ảnh của mặt hàng: trả ảnh (thumbnail) để bạn xem trực tiếp, kèm URL xem có thời hạn (token bí mật) của từng ảnh " +
        "(không cần cookie đăng nhập). Để người dùng thấy ảnh ngay trong câu trả lời, chèn markdown ![mô tả](thumbnailUrl); " +
        "url là ảnh gốc kích thước đầy đủ.",
      inputSchema: {
        id: z.number().int().positive().optional(),
        sku: z.string().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe("Số ảnh trả kèm để bạn xem trực tiếp: tối đa 4, mặc định 2. URL thì luôn có cho mọi ảnh."),
      },
      annotations: readOnly,
    },
    run(false, async (a: { id?: number; sku?: string; limit?: number }) => {
      const id = await findItemId(auth.userId, a);
      const it = await getItem(id);
      if (!it) return fail(`Không có mặt hàng id=${id}`);
      const all = it.media
        .filter((m) => m.kind === "image")
        .sort((x, y) => (x.id === it.coverMediaId ? -1 : y.id === it.coverMediaId ? 1 : 0))
        .slice(0, MAX_IMAGE_URLS);
      if (!all.length) return json({ message: "Mặt hàng chưa có ảnh", id });

      // Link xem có thời hạn: client chat không có cookie của app nên /api/media/… thường sẽ bị 401
      const link = await createMediaLink({ userId: auth.userId, itemId: id, apiTokenId: auth.tokenId });
      const alt = it.name.replace(/[\[\]\\]/g, " ").replace(/\s+/g, " ").trim();
      // Ảnh trả kèm cho model xem: chỉ bản thumbnail hoặc ảnh gốc nhỏ (base64 đi qua context)
      const images = all.filter((m) => m.thumbKey || m.size <= 1_500_000).slice(0, a.limit ?? 2);

      const content: CallToolResult["content"] = [
        {
          type: "text",
          text: JSON.stringify(
            {
              item: { id, name: it.name, url: itemUrl(id) },
              images: all.map((m) => {
                const thumbnailUrl = link.urlFor(m.id, { thumb: true });
                return {
                  id: m.id,
                  filename: m.filename,
                  isCover: m.id === it.coverMediaId,
                  thumbnailUrl,
                  url: link.urlFor(m.id),
                  markdown: `![${alt}](${thumbnailUrl})`,
                };
              }),
              linksExpireAt: link.expiresAt,
              note:
                "Chèn trường markdown vào câu trả lời để người dùng thấy ảnh. Link có token bí mật: chỉ xem được ảnh của " +
                `mặt hàng này, hết hạn lúc linksExpireAt (tối đa ${MEDIA_LINK_DAYS} ngày) — sau đó gọi lại tool để lấy link mới. Không đưa link cho bên thứ ba.`,
            },
            null,
            2,
          ),
        },
      ];
      for (const m of images) {
        const stream = await getObject(m.thumbKey ?? m.objectKey);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        content.push({
          type: "image",
          data: Buffer.concat(chunks).toString("base64"),
          mimeType: m.thumbKey ? "image/webp" : m.contentType,
        });
      }
      return { content };
    }),
  );

  const treeTool = (kind: "category" | "location") =>
    run(false, async () => {
      const tree = kind === "category" ? await getCategoryTree() : await getLocationTree();
      return json(
        tree.map((n) => ({
          id: n.id,
          name: n.name,
          path: n.path,
          parentId: n.parentId,
          ...("code" in n ? { code: n.code } : {}),
          itemCount: n.itemCount,
        })),
      );
    });

  server.registerTool(
    "list_categories",
    { title: "Danh sách danh mục", description: "Cây danh mục (kèm đường dẫn và số mặt hàng, gồm cả mục con).", annotations: readOnly },
    treeTool("category"),
  );

  server.registerTool(
    "list_locations",
    { title: "Danh sách vị trí cất", description: "Cây vị trí cất đồ (tủ, ngăn, hộp…) kèm số mặt hàng.", annotations: readOnly },
    treeTool("location"),
  );

  server.registerTool(
    "list_movements",
    {
      title: "Lịch sử nhập / xuất",
      description: "Lịch sử thay đổi số lượng, mới nhất trước. Lọc theo mặt hàng, loại, hoặc từ khoá (tên hàng, dự án, ghi chú).",
      inputSchema: {
        itemId: z.number().int().positive().optional(),
        type: z.enum(["in", "out", "adjust"]).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe("Mặc định 20"),
      },
      annotations: readOnly,
    },
    run(false, async (a: { itemId?: number; type?: "in" | "out" | "adjust"; query?: string; limit?: number }) => {
      const limit = a.limit ?? 20;
      if (a.itemId) {
        const rows = await getItemMovements(a.itemId, limit);
        return json(rows.map((m) => ({ itemId: a.itemId, type: m.type, delta: m.delta, balanceAfter: m.balanceAfter, reference: m.reference, note: m.note, at: m.createdAt })));
      }
      const res = await listMovements({ type: a.type, q: a.query });
      return json(
        res.rows.slice(0, limit).map(({ movement: m, item }) => ({
          itemId: item.id,
          item: item.name,
          unit: item.unit,
          type: m.type,
          delta: m.delta,
          balanceAfter: m.balanceAfter,
          reference: m.reference,
          note: m.note,
          at: m.createdAt,
        })),
      );
    }),
  );

  /* ---------- Ghi ---------- */

  server.registerTool(
    "create_item",
    {
      title: "Thêm mặt hàng",
      description:
        "Thêm mặt hàng mới. Nên search_items trước để tránh trùng. quantity ban đầu được ghi là một lần nhập kho.",
      inputSchema: {
        name: z.string().min(1).max(300),
        quantity: z.number().min(0).optional().describe("Số lượng hiện có, mặc định 0"),
        ...itemFields,
      },
      annotations: writeHint,
    },
    run(true, async (a: Record<string, unknown> & { name: string; createMissing?: boolean }) => {
      const categoryId = await resolveRef("category", a.category as never, auth.userId, !!a.createMissing);
      const locationId = await resolveRef("location", a.location as never, auth.userId, !!a.createMissing);
      const data = validateItem({
        name: a.name,
        sku: a.sku ?? null,
        kind: a.kind ?? "component",
        categoryId,
        locationId,
        manufacturer: a.manufacturer ?? null,
        mpn: a.mpn ?? null,
        package: a.package ?? null,
        description: a.description ?? null,
        specs: a.specs ?? [],
        tags: a.tags ?? [],
        unit: a.unit ?? "cái",
        quantity: a.quantity ?? 0,
        minQuantity: a.minQuantity ?? 0,
        unitPrice: a.unitPrice ?? null,
        supplier: a.supplier ?? null,
        purchaseUrl: a.purchaseUrl ?? null,
        datasheetUrl: a.datasheetUrl ?? null,
        notes: a.notes ?? null,
      });
      const id = await createItemFor(auth.userId, data);
      const it = await getItem(id);
      return json({ created: true, item: summarizeItem(it!) });
    }),
  );

  server.registerTool(
    "update_item",
    {
      title: "Sửa mặt hàng",
      description:
        "Sửa thông tin mặt hàng — chỉ cần truyền các trường muốn đổi (null để xoá giá trị). " +
        "Để đổi số lượng hãy dùng record_movement (truyền quantity ở đây sẽ được ghi là kiểm kê).",
      inputSchema: {
        id: z.number().int().positive().optional(),
        sku: z.string().optional().describe("Tìm mặt hàng theo SKU hiện tại (nếu không có id)"),
        name: z.string().min(1).max(300).optional(),
        newSku: z.string().max(100).nullish().describe("Đổi SKU"),
        quantity: z.number().min(0).optional(),
        ...Object.fromEntries(Object.entries(itemFields).filter(([k]) => k !== "sku")),
      },
      annotations: writeHint,
    },
    run(true, async (a: Record<string, unknown> & { id?: number; sku?: string; createMissing?: boolean }) => {
      const id = await findItemId(auth.userId, { id: a.id, sku: a.sku });
      const cur = await getItem(id);
      if (!cur) return fail(`Không có mặt hàng id=${id}`);
      const pick = <T,>(key: string, current: T) => (key in a && a[key] !== undefined ? (a[key] as T) : current);
      const data = validateItem({
        name: pick("name", cur.name),
        sku: pick("newSku", cur.sku),
        kind: pick("kind", cur.kind),
        categoryId:
          "category" in a && a.category !== undefined
            ? await resolveRef("category", a.category as never, auth.userId, !!a.createMissing)
            : cur.categoryId,
        locationId:
          "location" in a && a.location !== undefined
            ? await resolveRef("location", a.location as never, auth.userId, !!a.createMissing)
            : cur.locationId,
        manufacturer: pick("manufacturer", cur.manufacturer),
        mpn: pick("mpn", cur.mpn),
        package: pick("package", cur.package),
        description: pick("description", cur.description),
        specs: pick("specs", cur.specs) ?? [],
        tags: pick("tags", cur.tags) ?? [],
        unit: pick("unit", cur.unit),
        quantity: pick("quantity", cur.quantity),
        minQuantity: pick("minQuantity", cur.minQuantity),
        unitPrice: pick("unitPrice", cur.unitPrice),
        supplier: pick("supplier", cur.supplier),
        purchaseUrl: pick("purchaseUrl", cur.purchaseUrl),
        datasheetUrl: pick("datasheetUrl", cur.datasheetUrl),
        notes: pick("notes", cur.notes),
      });
      await updateItemFor(auth.userId, id, data, "Cập nhật qua agent (MCP)");
      const it = await getItem(id);
      return json({ updated: true, item: summarizeItem(it!) });
    }),
  );

  server.registerTool(
    "record_movement",
    {
      title: "Nhập / xuất / kiểm kê",
      description:
        "Thay đổi số lượng và ghi lịch sử. type: in = nhập thêm amount, out = lấy ra amount, " +
        "adjust = đặt số lượng thực tế bằng amount (kiểm kê). Không cho xuất quá số đang có.",
      inputSchema: {
        id: z.number().int().positive().optional().describe("id mặt hàng"),
        sku: z.string().optional(),
        type: z.enum(["in", "out", "adjust"]),
        amount: z.number().min(0),
        reference: z.string().max(200).optional().describe("Dự án / đơn hàng / nguồn"),
        note: z.string().max(1000).optional(),
        unitPrice: z.number().min(0).optional().describe("Đơn giá nhập (chỉ với type=in; cập nhật đơn giá mặt hàng)"),
      },
      annotations: writeHint,
    },
    run(true, async (a: { id?: number; sku?: string; type: "in" | "out" | "adjust"; amount: number; reference?: string; note?: string; unitPrice?: number }) => {
      const id = await findItemId(auth.userId, a);
      const { delta, balance } = await recordMovementFor(auth.userId, id, a.type, a.amount, {
        reference: a.reference,
        note: a.note ?? "Qua agent (MCP)",
        unitPrice: a.type === "in" ? a.unitPrice : undefined,
      });
      const it = await getItem(id);
      return json({ ok: true, itemId: id, name: it?.name, type: a.type, delta, quantity: balance, unit: it?.unit });
    }),
  );

  server.registerTool(
    "create_upload_url",
    {
      title: "Xin link upload ảnh / file",
      description:
        "Tạo link upload ngắn hạn cho 1 mặt hàng để gắn ảnh / video / PDF. Agent POST nội dung file thẳng lên link bằng " +
        "lệnh shell (curl), nên file không đi qua model (không tốn token) và không cần API token. " +
        "Một link dùng được cho nhiều file tới khi hết hạn hoặc hết lượt. Mỗi file 1 lệnh: " +
        'curl -sS -X POST "<uploadUrl>&filename=<tên file có đuôi>" --data-binary @"<đường dẫn file>"  ' +
        "(loại file đoán theo đuôi tên file; thêm &cover=1 để đặt làm ảnh đại diện — ảnh đầu tiên tự thành ảnh đại diện).",
      inputSchema: {
        id: z.number().int().positive().optional().describe("id mặt hàng"),
        sku: z.string().optional(),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(UPLOAD_LINK_MAX_MINUTES)
          .optional()
          .describe(`Thời hạn link (phút), mặc định 15, tối đa ${UPLOAD_LINK_MAX_MINUTES}`),
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(UPLOAD_LINK_MAX_FILES)
          .optional()
          .describe(`Số file tối đa upload qua link, mặc định 10, tối đa ${UPLOAD_LINK_MAX_FILES}`),
      },
      annotations: writeHint,
    },
    run(true, async (a: { id?: number; sku?: string; minutes?: number; maxFiles?: number }) => {
      const id = await findItemId(auth.userId, a);
      const link = await createUploadLink({
        userId: auth.userId,
        itemId: id,
        apiTokenId: auth.tokenId,
        minutes: a.minutes ?? 15,
        maxUploads: a.maxFiles ?? 10,
      });
      return json({
        itemId: id,
        name: link.item.name,
        uploadUrl: link.url,
        expiresAt: link.expiresAt,
        maxFiles: link.maxUploads,
        example: `curl -sS -X POST "${link.url}&filename=anh-1.jpg" --data-binary @"/duong/dan/anh-1.jpg"`,
        itemUrl: itemUrl(id),
      });
    }),
  );

  server.registerTool(
    "create_category",
    {
      title: "Thêm danh mục",
      description: "Tạo danh mục. parent là id hoặc tên/đường dẫn danh mục cha (bỏ trống = cấp gốc).",
      inputSchema: {
        name: z.string().min(1).max(100),
        parent: refSchema.optional(),
        description: z.string().max(500).optional(),
      },
      annotations: writeHint,
    },
    run(true, async (a: { name: string; parent?: number | string; description?: string }) => {
      const parentId = await resolveRef("category", a.parent, auth.userId, false);
      const dup = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.userId, auth.userId), eq(categories.name, a.name.trim())));
      const id = await createCategoryFor(auth.userId, { name: a.name.trim(), parentId, description: a.description });
      const path = (await getCategoryTree()).find((n) => n.id === id)?.path;
      return json({ created: true, id, path, warning: dup.length ? "Đã có danh mục khác cùng tên" : undefined });
    }),
  );

  server.registerTool(
    "create_location",
    {
      title: "Thêm vị trí cất",
      description: "Tạo vị trí cất đồ (tủ, ngăn, hộp…). parent là id hoặc tên/đường dẫn vị trí cha.",
      inputSchema: {
        name: z.string().min(1).max(100),
        code: z.string().max(50).optional().describe("Mã / nhãn dán, ví dụ A1-03"),
        parent: refSchema.optional(),
        description: z.string().max(500).optional(),
      },
      annotations: writeHint,
    },
    run(true, async (a: { name: string; code?: string; parent?: number | string; description?: string }) => {
      const parentId = await resolveRef("location", a.parent, auth.userId, false);
      const id = await createLocationFor(auth.userId, { name: a.name.trim(), code: a.code, parentId, description: a.description });
      const path = (await getLocationTree()).find((n) => n.id === id)?.path;
      return json({ created: true, id, path });
    }),
  );

  return server;
}
