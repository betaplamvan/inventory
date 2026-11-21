import "server-only";
import { revalidatePath } from "next/cache";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { categories, items, type Domain, type ItemKind } from "@/db/schema";
import { runAsUser } from "@/lib/auth/actor";
import { appBaseUrl } from "@/lib/auth/constants";
import type { TokenScope } from "@/lib/auth/api-tokens";
import { ITEM_KINDS, KIND_LABELS, MOVEMENT_LABELS } from "@/lib/constants";
import { DOMAINS, DOMAIN_CONFIG, EXPIRING_DAYS } from "@/lib/domains";
import { fmtDate, fmtQty } from "@/lib/format";
import {
  MAX_SHOPPING_BATCH,
  addShoppingFor,
  listShoppingFor,
  removeShoppingFor,
  setShoppingDoneFor,
  updateShoppingFor,
} from "@/lib/inventory/shopping";
import { itemSchema, type ItemInput } from "@/lib/item-input";
import { importRows, type ImportRow } from "@/lib/inventory/import";
import {
  InventoryError,
  createCategoryFor,
  createItemFor,
  createLocationFor,
  pgErrorMessage,
  recordMovementFor,
  updateItemFor,
} from "@/lib/inventory/mutations";
import { resolveRef } from "@/lib/inventory/refs";
import { liveItemOf } from "@/lib/inventory/scope";
import { TRASH_DAYS, listTrashFor, restoreItemFor, trashItemFor } from "@/lib/inventory/trash";
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

export type McpAuth = {
  userId: string;
  scope: TokenScope;
  tokenId?: string;
  tokenName?: string;
  /** Kho mặc định khi tool không truyền domain (trợ lý chat: kho của cuộc trò chuyện). Không có = tìm mọi kho. */
  defaultDomain?: Domain;
};

/** import_items: số dòng tối đa mỗi lần gọi */
const MAX_IMPORT_TOOL_ROWS = 100;

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

/* ------------------------------------------------------------------ */
/* Schema trường mặt hàng                                              */
/* ------------------------------------------------------------------ */

const domainSchema = z
  .enum(DOMAINS as [Domain, ...Domain[]])
  .describe("Kho: electronics = linh kiện điện tử, wardrobe = tủ quần áo, pantry = tủ bếp / thực phẩm");

const kindSchema = z
  .enum(ITEM_KINDS as [string, ...string[]])
  .describe(
    "Loại (mỗi kho một nhóm): " +
      DOMAINS.map(
        (d) => `${d}: ${DOMAIN_CONFIG[d].kinds.map((k) => `${k} = ${KIND_LABELS[k]}`).join(", ")}`,
      ).join(" | "),
  );

const itemFields = {
  sku: z.string().max(100).nullish().describe("Mã riêng do người dùng đặt (không trùng trong kho)"),
  kind: kindSchema.optional(),
  category: refSchema.nullish().describe("Danh mục: id hoặc tên / đường dẫn"),
  location: refSchema.nullish().describe("Vị trí cất: id hoặc tên / đường dẫn, ví dụ \"Tủ A > Ngăn 3\""),
  createMissing: z.boolean().optional().describe("true → tự tạo danh mục / vị trí nếu chưa có"),
  manufacturer: z.string().max(200).nullish().describe("Hãng sản xuất / thương hiệu"),
  mpn: z.string().max(200).nullish().describe("Mã nhà sản xuất (MPN)"),
  package: z.string().max(100).nullish().describe("Package / kiểu chân, ví dụ DIP-8, SOT-23, 0805"),
  description: z.string().max(10000).nullish(),
  specs: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional()
    .describe('Thông số / đặc điểm, ví dụ [{"key":"Điện áp","value":"5V"}] hoặc [{"key":"Màu","value":"trắng"},{"key":"Size","value":"M"}]'),
  tags: z.array(z.string()).optional(),
  unit: z.string().max(30).optional().describe('Đơn vị: "cái", "con", "chiếc", "đôi", "g", "kg", "quả"…'),
  minQuantity: z.number().min(0).optional().describe("Mức tối thiểu; thấp hơn sẽ báo cần mua thêm (0 = không theo dõi)"),
  unitPrice: z.number().min(0).nullish().describe("Đơn giá (VNĐ)"),
  supplier: z.string().max(200).nullish().describe("Nhà cung cấp, ví dụ Ban Linh Kiện, Hshop, LCSC"),
  purchaseUrl: z.string().url().nullish().describe("Link mua hàng"),
  datasheetUrl: z.string().url().nullish().describe("Link datasheet"),
  notes: z.string().max(10000).nullish(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .describe("Hạn sử dụng YYYY-MM-DD (kho thực phẩm)"),
};

/** Trường của 1 dòng trong import_items: như itemFields, trừ createMissing (là tuỳ chọn chung của cả lần nhập) */
const { createMissing: _createMissing, ...importFields } = itemFields;

function summarizeItem(it: {
  id: number;
  domain: Domain;
  expiresAt?: string | null;
  expiryDays?: number | null;
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
    domain: it.domain,
    name: it.name,
    sku: it.sku,
    kind: it.kind,
    ...(it.expiresAt ? { expiresAt: it.expiresAt, expiresInDays: it.expiryDays ?? undefined } : {}),
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
      .where(and(liveItemOf(userId), eq(items.sku, ref.sku)));
    if (!row) throw new InventoryError(`Không có mặt hàng SKU "${ref.sku}"`);
    return row.id;
  }
  throw new InventoryError("Cần truyền id hoặc sku");
}

/** Nguồn của một dòng lịch sử: "web", "agent: <tên token>", "import"; null = dữ liệu cũ */
const sourceOf = (m: { source: string | null; sourceName: string | null }) =>
  m.source ? (m.sourceName ? `${m.source}: ${m.sourceName}` : m.source) : null;

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
    { name: "kho-linh-kien", version: "2.0.0" },
    {
      instructions:
        "Kho đồ cá nhân của người dùng, gồm 3 kho (tham số domain): electronics = linh kiện điện tử, " +
        "wardrobe = tủ quần áo, pantry = tủ bếp / thực phẩm (có hạn sử dụng). Mặt hàng, danh mục, vị trí thuộc đúng 1 kho; " +
        "tool đọc không truyền domain thì xem mọi kho, tool ghi không truyền domain thì mặc định electronics. " +
        "Brainstorm (mạch DIY, phối đồ, món ăn từ đồ đang có): gọi inventory_snapshot của kho đó để xem gọn mọi thứ đang có; " +
        "thứ còn thiếu thì thêm vào danh sách cần mua bằng add_shopping_items. " +
        "Tìm trước bằng search_items để tránh tạo trùng. Thay đổi số lượng bằng record_movement " +
        "(in = nhập thêm, out = lấy ra dùng, adjust = đặt số lượng thực tế khi kiểm kê) để có lịch sử. " +
        "Tiền tệ là VNĐ. Danh mục / vị trí có thể truyền bằng tên, ví dụ \"Tụ điện > Tụ gốm\". " +
        "Gắn ảnh / file: gọi create_upload_url lấy link rồi POST file thẳng lên bằng curl (file không đi qua model). " +
        "Thêm nhiều mặt hàng một lúc (cả đơn hàng, bảng kê) thì dùng import_items thay vì gọi create_item nhiều lần. " +
        `delete_item chỉ chuyển vào thùng rác (khôi phục bằng restore_item trong ${TRASH_DAYS} ngày); xoá hẳn chỉ làm được trên web.`,
    },
  );

  /** Bọc tool: chạy với quyền của chủ token, bắt lỗi nghiệp vụ, chặn ghi nếu token chỉ đọc. */
  const run =
    <A,>(write: boolean, fn: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      if (write && auth.scope !== "write") return fail("Token này chỉ có quyền đọc (scope=read).");
      try {
        // via: lịch sử nhập/xuất ghi rõ thao tác do agent nào (tên token / kết nối OAuth) thực hiện
        const result = await runAsUser(auth.userId, () => fn(args), { source: "agent", name: auth.tokenName });
        if (write) {
          // Làm mới cache trang: cố gắng hết sức — dữ liệu đã ghi xong, không được báo lỗi vì bước này
          // (vd. trợ lý chat chạy nền sau khi trình duyệt đã ngắt kết nối)
          try {
            revalidatePath("/", "layout");
          } catch (err) {
            console.warn("[mcp] revalidatePath bỏ qua:", (err as Error).message);
          }
        }
        return result;
      } catch (err) {
        return fail(pgErrorMessage(err));
      }
    };

  /** Kho để đọc: truyền vào > mặc định của phiên > undefined (= mọi kho) */
  const readDomain = (d?: Domain) => d ?? auth.defaultDomain;
  /** Kho để ghi: truyền vào > mặc định của phiên > điện tử (tương thích agent cũ) */
  const writeDomain = (d?: Domain) => d ?? auth.defaultDomain ?? "electronics";

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const writeHint = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  /* ---------- Đọc ---------- */

  server.registerTool(
    "inventory_overview",
    {
      title: "Tổng quan kho",
      description:
        "Số mặt hàng, giá trị ước tính, số món sắp hết / hết, sắp hết hạn (thực phẩm), danh sách cần mua thêm, giao dịch gần đây. " +
        "Không truyền domain = tổng quan cả 3 kho.",
      inputSchema: { domain: domainSchema.optional() },
      annotations: readOnly,
    },
    run(false, async (a: { domain?: Domain }) => {
      const one = readDomain(a.domain);
      if (!one) {
        const all = await Promise.all(DOMAINS.map(async (d) => [d, await overview(d)] as const));
        return json(Object.fromEntries(all));
      }
      return json(await overview(one));
    }),
  );

  async function overview(domain: Domain) {
      const d = await getDashboard(domain);
      return {
        domain,
        space: DOMAIN_CONFIG[domain].space,
        totals: d.totals,
        expiringSoon: DOMAIN_CONFIG[domain].showExpiry
          ? d.expiring.map((it) => ({
              id: it.id,
              name: it.name,
              quantity: it.quantity,
              unit: it.unit,
              expiresAt: it.expiresAt,
              expiresInDays: it.expiryDays,
            }))
          : undefined,
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
      };
  }

  server.registerTool(
    "search_items",
    {
      title: "Tìm mặt hàng",
      description:
        "Tìm / lọc mặt hàng. query tìm theo tên, SKU, MPN, package, tag, thông số (không phân biệt dấu tiếng Việt). " +
        "Không truyền domain = tìm cả 3 kho (lọc theo danh mục / vị trí thì cần domain).",
      inputSchema: {
        domain: domainSchema.optional(),
        query: z.string().optional(),
        category: refSchema.optional().describe("Lọc theo danh mục (gồm cả danh mục con)"),
        location: refSchema.optional().describe("Lọc theo vị trí (gồm cả vị trí con)"),
        kind: kindSchema.optional(),
        stock: z
          .enum(["all", "in", "low", "out", "expiring", "expired"])
          .optional()
          .describe(`in = còn hàng, low = cần mua thêm, out = hết, expiring = hết hạn trong ${EXPIRING_DAYS} ngày, expired = đã quá hạn`),
        sort: z.enum(["updated", "created", "name", "qty", "value", "expiry"]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Mặc định 20"),
        page: z.number().int().min(1).optional(),
      },
      annotations: readOnly,
    },
    run(false, async (a: {
      domain?: Domain;
      query?: string;
      category?: number | string;
      location?: number | string;
      kind?: string;
      stock?: StockFilter;
      sort?: SortKey;
      limit?: number;
      page?: number;
    }) => {
      const domain = readDomain(a.domain);
      if ((a.category != null || a.location != null) && !domain) {
        return fail("Lọc theo danh mục / vị trí cần truyền domain (danh mục mỗi kho khác nhau)");
      }
      const res = await listItems({
        domain,
        q: a.query,
        categoryId: domain ? ((await resolveRef("category", a.category, auth.userId, false, domain)) ?? undefined) : undefined,
        locationId: domain ? ((await resolveRef("location", a.location, auth.userId, false, domain)) ?? undefined) : undefined,
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
      const [it, movements] = await Promise.all([getItem(id), getItemMovements(id, a.movementLimit ?? 20)]);
      if (!it) return fail(`Không có mặt hàng id=${id}`);
      const [catTree, locTree] = await Promise.all([getCategoryTree(it.domain), getLocationTree(it.domain)]);
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
          source: sourceOf(m),
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
    run(false, async (a: { domain?: Domain }) => {
      const domain = readDomain(a.domain);
      const tree = kind === "category" ? await getCategoryTree(domain) : await getLocationTree(domain);
      return json(
        tree.map((n) => ({
          id: n.id,
          domain: n.domain,
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
    {
      title: "Danh sách danh mục",
      description: "Cây danh mục (kèm đường dẫn và số mặt hàng, gồm cả mục con). Không truyền domain = mọi kho.",
      inputSchema: { domain: domainSchema.optional() },
      annotations: readOnly,
    },
    treeTool("category"),
  );

  server.registerTool(
    "list_locations",
    {
      title: "Danh sách vị trí cất",
      description: "Cây vị trí cất đồ (tủ, ngăn, hộp, tủ lạnh…) kèm số mặt hàng. Không truyền domain = mọi kho.",
      inputSchema: { domain: domainSchema.optional() },
      annotations: readOnly,
    },
    treeTool("location"),
  );

  server.registerTool(
    "list_movements",
    {
      title: "Lịch sử nhập / xuất",
      description:
        "Lịch sử thay đổi số lượng, mới nhất trước. Lọc theo mặt hàng, loại, hoặc từ khoá (tên hàng, dự án, ghi chú). " +
        "source cho biết thao tác đến từ đâu: web, agent: <tên token>, import (CSV).",
      inputSchema: {
        domain: domainSchema.optional(),
        itemId: z.number().int().positive().optional(),
        type: z.enum(["in", "out", "adjust"]).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe("Mặc định 20"),
      },
      annotations: readOnly,
    },
    run(false, async (a: { domain?: Domain; itemId?: number; type?: "in" | "out" | "adjust"; query?: string; limit?: number }) => {
      const limit = a.limit ?? 20;
      if (a.itemId) {
        const rows = await getItemMovements(a.itemId, limit);
        return json(rows.map((m) => ({ itemId: a.itemId, type: m.type, delta: m.delta, balanceAfter: m.balanceAfter, reference: m.reference, note: m.note, source: sourceOf(m), at: m.createdAt })));
      }
      const res = await listMovements({ domain: readDomain(a.domain), type: a.type, q: a.query });
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
          source: sourceOf(m),
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
        "Thêm mặt hàng mới vào một kho. Nên search_items trước để tránh trùng. quantity ban đầu được ghi là một lần nhập kho.",
      inputSchema: {
        domain: domainSchema.optional().describe("Kho của mặt hàng (mặc định electronics)"),
        name: z.string().min(1).max(300),
        quantity: z.number().min(0).optional().describe("Số lượng hiện có, mặc định 0"),
        ...itemFields,
      },
      annotations: writeHint,
    },
    run(true, async (a: Record<string, unknown> & { domain?: Domain; name: string; createMissing?: boolean }) => {
      const domain = writeDomain(a.domain);
      const cfg = DOMAIN_CONFIG[domain];
      const categoryId = await resolveRef("category", a.category as never, auth.userId, !!a.createMissing, domain);
      const locationId = await resolveRef("location", a.location as never, auth.userId, !!a.createMissing, domain);
      const data = validateItem({
        domain,
        name: a.name,
        sku: a.sku ?? null,
        kind: a.kind ?? cfg.defaultKind,
        categoryId,
        locationId,
        manufacturer: a.manufacturer ?? null,
        mpn: a.mpn ?? null,
        package: a.package ?? null,
        description: a.description ?? null,
        specs: a.specs ?? [],
        tags: a.tags ?? [],
        unit: a.unit ?? cfg.defaultUnit,
        quantity: a.quantity ?? 0,
        minQuantity: a.minQuantity ?? 0,
        unitPrice: a.unitPrice ?? null,
        supplier: a.supplier ?? null,
        purchaseUrl: a.purchaseUrl ?? null,
        datasheetUrl: a.datasheetUrl ?? null,
        notes: a.notes ?? null,
        expiresAt: a.expiresAt ?? null,
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
        domain: cur.domain,
        name: pick("name", cur.name),
        sku: pick("newSku", cur.sku),
        kind: pick("kind", cur.kind),
        categoryId:
          "category" in a && a.category !== undefined
            ? await resolveRef("category", a.category as never, auth.userId, !!a.createMissing, cur.domain)
            : cur.categoryId,
        locationId:
          "location" in a && a.location !== undefined
            ? await resolveRef("location", a.location as never, auth.userId, !!a.createMissing, cur.domain)
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
        expiresAt: pick("expiresAt", cur.expiresAt),
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
        // Nguồn (agent nào) đã ghi ở cột source / source_name — không cần ghi chú mặc định
        note: a.note ?? null,
        unitPrice: a.type === "in" ? a.unitPrice : undefined,
      });
      const it = await getItem(id);
      return json({ ok: true, itemId: id, name: it?.name, type: a.type, delta, quantity: balance, unit: it?.unit });
    }),
  );


  server.registerTool(
    "import_items",
    {
      title: "Nhập nhiều mặt hàng",
      description:
        `Thêm / cập nhật nhiều mặt hàng trong một lần gọi (tối đa ${MAX_IMPORT_TOOL_ROWS} dòng) — dùng cho cả đơn hàng, bảng kê, BOM. ` +
        "Mỗi dòng: có id hoặc sku trùng mặt hàng đang có → cập nhật (chỉ các trường được truyền; quantity là số lượng thực tế, " +
        "ghi thành kiểm kê); không khớp → thêm mới (cần name). Dòng lỗi không chặn các dòng khác. " +
        "Nên gọi dryRun=true trước để xem sẽ thêm / sửa gì.",
      inputSchema: {
        domain: domainSchema.optional().describe("Kho nhận dữ liệu (mặc định electronics)"),
        items: z
          .array(
            z.object({
              name: z.string().min(1).max(300).optional().describe("Tên mặt hàng — BẮT BUỘC với dòng thêm mới"),
              id: z.number().int().positive().optional().describe("id mặt hàng đang có (để cập nhật)"),
              quantity: z.number().min(0).optional(),
              ...importFields,
            }),
          )
          .min(1)
          .max(MAX_IMPORT_TOOL_ROWS),
        onExisting: z
          .enum(["update", "skip"])
          .optional()
          .describe("Dòng khớp mặt hàng đang có: update = cập nhật (mặc định), skip = bỏ qua"),
        createMissing: z.boolean().optional().describe("true → tự tạo danh mục / vị trí chưa có"),
        dryRun: z.boolean().optional().describe("true → chỉ kiểm tra, không ghi gì"),
      },
      annotations: writeHint,
    },
    run(true, async (a: { domain?: Domain; items: Omit<ImportRow, "line">[]; onExisting?: "update" | "skip"; createMissing?: boolean; dryRun?: boolean }) => {
      // Dòng thêm mới thiếu tên: báo rõ từng dòng để model gửi lại đúng (thay vì lỗi chung "Vui lòng nhập tên")
      const noName = a.items
        .map((it, i) => (!it.name?.trim() && it.id == null && !it.sku ? i + 1 : 0))
        .filter(Boolean);
      if (noName.length) {
        return fail(
          `Dòng ${noName.join(", ")} thiếu "name" (tên mặt hàng) — bắt buộc khi thêm mới. Gửi lại import_items với name cho từng dòng.`,
        );
      }
      const res = await importRows(
        auth.userId,
        a.items.map((it, i) => ({ ...it, line: i + 1 })),
        {
          domain: writeDomain(a.domain),
          onExisting: a.onExisting ?? "update",
          createMissing: !!a.createMissing,
          dryRun: !!a.dryRun,
          adjustNote: "Nhập hàng loạt qua agent (MCP)",
        },
      );
      return json({
        dryRun: !!a.dryRun,
        created: res.created,
        updated: res.updated,
        skipped: res.skipped,
        failed: res.failed,
        rows: res.rows.map((r) => ({
          row: r.line,
          action: r.action,
          id: r.id,
          name: r.name,
          sku: r.sku,
          quantity: r.quantity,
          messages: r.messages.length ? r.messages : undefined,
          url: r.id && !a.dryRun ? itemUrl(r.id) : undefined,
        })),
      });
    }),
  );

  server.registerTool(
    "delete_item",
    {
      title: "Xoá mặt hàng (vào thùng rác)",
      description:
        `Chuyển mặt hàng vào thùng rác: ẩn khỏi kho nhưng giữ nguyên ảnh và lịch sử, khôi phục được bằng restore_item trong ${TRASH_DAYS} ngày ` +
        "(sau đó tự xoá hẳn). Chỉ dùng khi người dùng yêu cầu xoá; hết hàng thì không cần xoá.",
      inputSchema: {
        id: z.number().int().positive().optional(),
        sku: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    run(true, async (a: { id?: number; sku?: string }) => {
      const id = await findItemId(auth.userId, a);
      const row = await trashItemFor(auth.userId, id);
      return json({ deleted: true, id: row.id, name: row.name, restoreWith: "restore_item", keptDays: TRASH_DAYS });
    }),
  );

  server.registerTool(
    "list_trash",
    {
      title: "Xem thùng rác",
      description: "Các mặt hàng đã xoá còn khôi phục được (mới xoá trước), kèm ai xoá và khi nào. Không truyền domain = mọi kho.",
      inputSchema: { domain: domainSchema.optional() },
      annotations: readOnly,
    },
    run(false, async (a: { domain?: Domain }) => {
      const rows = await listTrashFor(auth.userId, readDomain(a.domain));
      return json(
        rows.map((r) => ({
          id: r.id,
          domain: r.domain,
          name: r.name,
          sku: r.sku,
          quantity: r.quantity,
          unit: r.unit,
          deletedAt: r.deletedAt,
          deletedBy: r.deletedBy,
        })),
      );
    }),
  );

  server.registerTool(
    "restore_item",
    {
      title: "Khôi phục mặt hàng",
      description: "Đưa mặt hàng từ thùng rác trở lại kho (lấy id từ list_trash).",
      inputSchema: { id: z.number().int().positive() },
      annotations: writeHint,
    },
    run(true, async (a: { id: number }) => {
      const res = await restoreItemFor(auth.userId, a.id);
      return json({
        restored: true,
        id: res.id,
        name: res.name,
        url: itemUrl(res.id),
        warning: res.skuCleared ? `SKU "${res.skuCleared}" đang được mặt hàng khác dùng nên đã bỏ trống` : undefined,
      });
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
      description: "Tạo danh mục trong một kho. parent là id hoặc tên/đường dẫn danh mục cha (bỏ trống = cấp gốc).",
      inputSchema: {
        domain: domainSchema.optional().describe("Kho (mặc định electronics)"),
        name: z.string().min(1).max(100),
        parent: refSchema.optional(),
        description: z.string().max(500).optional(),
      },
      annotations: writeHint,
    },
    run(true, async (a: { domain?: Domain; name: string; parent?: number | string; description?: string }) => {
      const domain = writeDomain(a.domain);
      const parentId = await resolveRef("category", a.parent, auth.userId, false, domain);
      const dup = await db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(eq(categories.userId, auth.userId), eq(categories.domain, domain), eq(categories.name, a.name.trim())),
        );
      const id = await createCategoryFor(auth.userId, { domain, name: a.name.trim(), parentId, description: a.description });
      const path = (await getCategoryTree(domain)).find((n) => n.id === id)?.path;
      return json({ created: true, id, path, warning: dup.length ? "Đã có danh mục khác cùng tên" : undefined });
    }),
  );

  server.registerTool(
    "create_location",
    {
      title: "Thêm vị trí cất",
      description: "Tạo vị trí cất đồ (tủ, ngăn, hộp, tủ lạnh…) trong một kho. parent là id hoặc tên/đường dẫn vị trí cha.",
      inputSchema: {
        domain: domainSchema.optional().describe("Kho (mặc định electronics)"),
        name: z.string().min(1).max(100),
        code: z.string().max(50).optional().describe("Mã / nhãn dán, ví dụ A1-03"),
        parent: refSchema.optional(),
        description: z.string().max(500).optional(),
      },
      annotations: writeHint,
    },
    run(true, async (a: { domain?: Domain; name: string; code?: string; parent?: number | string; description?: string }) => {
      const domain = writeDomain(a.domain);
      const parentId = await resolveRef("location", a.parent, auth.userId, false, domain);
      const id = await createLocationFor(auth.userId, {
        domain,
        name: a.name.trim(),
        code: a.code,
        parentId,
        description: a.description,
      });
      const path = (await getLocationTree(domain)).find((n) => n.id === id)?.path;
      return json({ created: true, id, path });
    }),
  );

  /* ---------- Brainstorm + danh sách cần mua ---------- */

  server.registerTool(
    "inventory_snapshot",
    {
      title: "Toàn cảnh một kho",
      description:
        "Danh sách gọn mọi thứ đang có trong một kho (mỗi món 1 dòng: id, tên, số lượng, loại, đặc điểm / thông số, " +
        "hạn sử dụng, vị trí) — dùng để brainstorm: mạch DIY làm được với linh kiện sẵn có, phối đồ từ tủ quần áo, " +
        "món ăn nấu được từ nguyên liệu trong bếp. Mặc định chỉ món còn hàng.",
      inputSchema: {
        domain: domainSchema,
        includeOutOfStock: z.boolean().optional().describe("true → gồm cả món đã hết"),
        kind: kindSchema.optional(),
        limit: z.number().int().min(1).max(400).optional().describe("Mặc định 250"),
      },
      annotations: readOnly,
    },
    run(false, async (a: { domain?: Domain; includeOutOfStock?: boolean; kind?: string; limit?: number }) => {
      const domain = readDomain(a.domain) ?? "electronics";
      const res = await listItems({
        domain,
        stock: a.includeOutOfStock ? undefined : "in",
        kind: a.kind as ItemKind | undefined,
        sort: DOMAIN_CONFIG[domain].showExpiry ? "expiry" : "name",
        pageSize: a.limit ?? 250,
      });
      const lines = res.rows.map((it) => {
        const parts = [
          `#${it.id} ${it.name}`,
          `${fmtQty(it.quantity)} ${it.unit}`,
          KIND_LABELS[it.kind],
          it.package,
          it.manufacturer,
          it.specs.length ? it.specs.map((s) => (s.value ? `${s.key}: ${s.value}` : s.key)).join("; ") : null,
          it.tags.length ? `tag: ${it.tags.join(", ")}` : null,
          it.expiresAt
            ? `HSD ${fmtDate(it.expiresAt)}${it.expiryDays != null ? (it.expiryDays < 0 ? " (ĐÃ QUÁ HẠN)" : ` (còn ${it.expiryDays} ngày)`) : ""}`
            : null,
          it.location?.name ? `ở ${it.location.name}` : null,
        ].filter(Boolean);
        return parts.join(" · ");
      });
      const more = res.total > res.rows.length ? `\n…còn ${res.total - res.rows.length} món nữa (tăng limit hoặc lọc kind)` : "";
      const head = `${DOMAIN_CONFIG[domain].space}: ${res.total} ${DOMAIN_CONFIG[domain].noun}${a.includeOutOfStock ? "" : " còn hàng"}. Link: ${appBaseUrl()}/items/<id>`;
      return { content: [{ type: "text", text: `${head}\n${lines.join("\n")}${more}` }] };
    }),
  );

  server.registerTool(
    "list_shopping_list",
    {
      title: "Danh sách cần mua",
      description:
        "Các món cần mua (người dùng hoặc trợ lý đã thêm) của một kho, kèm các món dưới mức tối thiểu (lowStock). " +
        "Không truyền domain = mọi kho.",
      inputSchema: {
        domain: domainSchema.optional(),
        includeDone: z.boolean().optional().describe("true → gồm cả món đã mua"),
      },
      annotations: readOnly,
    },
    run(false, async (a: { domain?: Domain; includeDone?: boolean }) => {
      const domain = readDomain(a.domain);
      const [list, low] = await Promise.all([
        listShoppingFor(auth.userId, domain, { includeDone: a.includeDone }),
        listItems({ domain, stock: "low", pageSize: 50, sort: "qty" }),
      ]);
      return json({
        shoppingList: list.map((s) => ({
          id: s.id,
          domain: s.domain,
          name: s.name,
          quantity: s.quantity,
          unit: s.unit,
          note: s.note,
          itemId: s.itemId,
          done: s.done,
          addedBy: s.addedBy,
        })),
        lowStock: low.rows.map((it) => ({
          id: it.id,
          domain: it.domain,
          name: it.name,
          quantity: it.quantity,
          minQuantity: it.minQuantity,
          unit: it.unit,
        })),
        pageUrl: `${appBaseUrl()}/shopping`,
      });
    }),
  );

  server.registerTool(
    "add_shopping_items",
    {
      title: "Thêm vào danh sách cần mua",
      description:
        `Thêm 1 hoặc nhiều món (tối đa ${MAX_SHOPPING_BATCH}) vào danh sách cần mua của một kho — vd. linh kiện còn thiếu ` +
        "cho mạch, món đồ để hoàn thiện bộ phối, nguyên liệu cho món ăn. Món trùng tên với món đang chờ mua thì gộp. " +
        "itemId: gắn với mặt hàng có sẵn trong kho (mua thêm món đã có) để khi đánh dấu đã mua có thể nhập kho luôn.",
      inputSchema: {
        domain: domainSchema.optional().describe("Kho (mặc định electronics)"),
        items: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              quantity: z.number().min(0).nullish(),
              unit: z.string().max(30).nullish(),
              note: z.string().max(500).nullish().describe("Lý do / dùng cho món gì, vd. 'cho mạch nháy LED 555'"),
              itemId: z.number().int().positive().nullish().describe("id mặt hàng có sẵn (nếu mua thêm món đã có)"),
            }),
          )
          .min(1)
          .max(MAX_SHOPPING_BATCH),
      },
      annotations: writeHint,
    },
    run(true, async (a: { domain?: Domain; items: { name: string; quantity?: number | null; unit?: string | null; note?: string | null; itemId?: number | null }[] }) => {
      const domain = writeDomain(a.domain);
      const res = await addShoppingFor(auth.userId, domain, a.items);
      return json({ domain, added: res.added.length, merged: res.merged.length, pageUrl: `${appBaseUrl()}/shopping` });
    }),
  );

  server.registerTool(
    "update_shopping_item",
    {
      title: "Sửa / đánh dấu món cần mua",
      description:
        "Đánh dấu đã mua (done=true; stockIn=true để nhập kho luôn nếu món gắn với mặt hàng có sẵn), sửa tên / số lượng / " +
        "ghi chú, hoặc xoá khỏi danh sách (remove=true).",
      inputSchema: {
        id: z.number().int().positive(),
        done: z.boolean().optional(),
        stockIn: z.boolean().optional().describe("Cùng với done=true: nhập kho số lượng đã mua vào mặt hàng gắn kèm"),
        name: z.string().min(1).max(200).optional(),
        quantity: z.number().min(0).nullish(),
        unit: z.string().max(30).nullish(),
        note: z.string().max(500).nullish(),
        itemId: z.number().int().positive().nullish(),
        remove: z.boolean().optional(),
      },
      annotations: writeHint,
    },
    run(true, async (a: { id: number; done?: boolean; stockIn?: boolean; remove?: boolean; name?: string; quantity?: number | null; unit?: string | null; note?: string | null; itemId?: number | null }) => {
      if (a.remove) {
        const n = await removeShoppingFor(auth.userId, [a.id]);
        return n ? json({ removed: true, id: a.id }) : fail(`Không có món id=${a.id}`);
      }
      const { id, done, stockIn, remove: _r, ...patch } = a;
      if (Object.values(patch).some((v) => v !== undefined)) await updateShoppingFor(auth.userId, id, patch);
      let stocked: number | undefined;
      if (done !== undefined) ({ balance: stocked } = await setShoppingDoneFor(auth.userId, id, done, { stockIn }));
      return json({ updated: true, id, done, stockedInQuantity: stocked });
    }),
  );

  return server;
}
