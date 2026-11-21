import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const itemKind = pgEnum("item_kind", [
  "component", // Linh kiện
  "module", // Module / board
  "tool", // Dụng cụ
  "consumable", // Vật tư tiêu hao
  "equipment", // Thiết bị / máy đo
  "other",
]);

export const movementType = pgEnum("movement_type", ["in", "out", "adjust"]);
export type MovementSource = "web" | "agent" | "import";
export const mediaKind = pgEnum("media_kind", ["image", "video", "file"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/* ------------------------------------------------------------------ */
/* Tài khoản & đăng nhập                                               */
/* ------------------------------------------------------------------ */

/** Người dùng — chỉ đăng nhập qua Google OAuth (không lưu mật khẩu). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** email Google đã xác minh, lưu dạng lower(trim()) */
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

/** Cách đăng nhập gắn với user: provider "google" + subject = Google `sub`. */
export const authIdentities = pgTable(
  "auth_identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] }), index("auth_identities_user_idx").on(t.userId)],
);

/** Phiên đăng nhập: cookie chứa token ngẫu nhiên, DB chỉ lưu SHA-256 của token. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const apiTokenScope = pgEnum("api_token_scope", ["read", "write"]);

/**
 * Client OAuth (Claude web / điện thoại, Claude Code, Cursor…) tự đăng ký qua
 * Dynamic Client Registration (RFC 7591) tại /api/oauth/register.
 */
export const oauthClients = pgTable("oauth_clients", {
  /** client_id công khai */
  id: text("id").primaryKey(),
  /** null = public client (token_endpoint_auth_method "none"), dùng PKCE */
  clientSecretHash: text("client_secret_hash"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  ...timestamps,
});

/** Mã uỷ quyền (authorization code) dùng 1 lần, sống 10 phút. DB chỉ lưu SHA-256. */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: apiTokenScope("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/**
 * Token cá nhân cho agent / MCP (Authorization: Bearer inv_…). DB chỉ lưu SHA-256.
 * Kết nối OAuth cũng là 1 dòng ở đây (oauth_client_id khác null): access token ngắn hạn
 * + refresh token, cả hai được xoay vòng mỗi lần refresh. Xoá dòng = thu hồi kết nối.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** vài ký tự đầu để người dùng nhận ra token (không đủ để dùng) */
    prefix: text("prefix").notNull(),
    scope: apiTokenScope("scope").notNull().default("write"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    oauthClientId: text("oauth_client_id").references(() => oauthClients.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").unique(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

export type ApiToken = typeof apiTokens.$inferSelect;

/**
 * Link upload ngắn hạn cho agent (tạo bằng tool MCP create_upload_url): chỉ upload vào 1 mặt hàng,
 * giới hạn số file và thời gian. URL chứa token ngẫu nhiên, DB chỉ lưu SHA-256.
 * Thu hồi API token → link tạo từ token đó mất hiệu lực theo (cascade).
 */
export const uploadLinks = pgTable(
  "upload_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references((): AnyPgColumn => items.id, { onDelete: "cascade" }),
    apiTokenId: uuid("api_token_id").references(() => apiTokens.id, { onDelete: "cascade" }),
    maxUploads: integer("max_uploads").notNull(),
    uploads: integer("uploads").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("upload_links_user_idx").on(t.userId)],
);

/**
 * Link xem ảnh có thời hạn cho agent (tool MCP get_item_images trả về): chỉ ĐỌC ảnh của 1 mặt hàng,
 * không cần cookie → client chat (Claude web / điện thoại) hiển thị được ảnh ngay trong câu trả lời.
 * URL chứa token ngẫu nhiên, DB chỉ lưu SHA-256. Thu hồi API token → link mất hiệu lực (cascade).
 */
export const mediaLinks = pgTable(
  "media_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references((): AnyPgColumn => items.id, { onDelete: "cascade" }),
    apiTokenId: uuid("api_token_id").references(() => apiTokens.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("media_links_user_idx").on(t.userId)],
);

/** Chủ sở hữu dữ liệu kho. Nullable chỉ để giữ dữ liệu tạo trước khi có tài khoản
 *  (được gán cho tài khoản đầu tiên đăng nhập). */
const owner = () => uuid("user_id").references(() => users.id, { onDelete: "cascade" });

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    userId: owner(),
    name: text("name").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("categories_user_idx").on(t.userId)],
);

export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    userId: owner(),
    name: text("name").notNull(),
    code: text("code"),
    parentId: integer("parent_id").references((): AnyPgColumn => locations.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    ...timestamps,
  },
  (t) => [index("locations_user_idx").on(t.userId)],
);

export type Spec = { key: string; value: string };

export const items = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    userId: owner(),
    name: text("name").notNull(),
    sku: text("sku"),
    kind: itemKind("kind").notNull().default("component"),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
    manufacturer: text("manufacturer"),
    mpn: text("mpn"),
    package: text("package"),
    description: text("description"),
    specs: jsonb("specs").$type<Spec[]>().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    unit: text("unit").notNull().default("cái"),
    quantity: qty("quantity").notNull().default(0),
    minQuantity: qty("min_quantity").notNull().default(0),
    unitPrice: money("unit_price"),
    supplier: text("supplier"),
    purchaseUrl: text("purchase_url"),
    datasheetUrl: text("datasheet_url"),
    notes: text("notes"),
    coverMediaId: integer("cover_media_id").references((): AnyPgColumn => media.id, {
      onDelete: "set null",
    }),
    /** Chuỗi đã bỏ dấu, chữ thường — dùng cho tìm kiếm tiếng Việt không dấu */
    searchText: text("search_text").notNull().default(""),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Thùng rác (xoá mềm): khác null = đã xoá, ẩn khỏi mọi danh sách, tự xoá hẳn sau TRASH_DAYS ngày */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Ai xoá: "web" hoặc "agent: <tên token>" */
    deletedBy: text("deleted_by"),
  },
  (t) => [
    index("items_user_idx").on(t.userId),
    // SKU chỉ cần không trùng giữa các mặt hàng đang dùng — món trong thùng rác không giữ chỗ
    uniqueIndex("items_user_sku_uq").on(t.userId, t.sku).where(sql`deleted_at is null`),
    index("items_category_idx").on(t.categoryId),
    index("items_location_idx").on(t.locationId),
    index("items_kind_idx").on(t.kind),
  ],
);

export const media = pgTable(
  "media",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references((): AnyPgColumn => items.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    thumbKey: text("thumb_key"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    kind: mediaKind("kind").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("media_item_idx").on(t.itemId)],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    type: movementType("type").notNull(),
    /** Số lượng thay đổi (dương = tăng, âm = giảm) */
    delta: qty("delta").notNull(),
    balanceAfter: qty("balance_after").notNull(),
    unitPrice: money("unit_price"),
    /** Dự án / đơn hàng / nguồn gốc */
    reference: text("reference"),
    note: text("note"),
    /** Thao tác đến từ đâu: "web" | "agent" (MCP) | "import" (CSV). null = dữ liệu cũ, không rõ */
    source: text("source").$type<MovementSource>(),
    /** Tên API token / kết nối OAuth đã thực hiện (lưu lại tên vì token có thể bị thu hồi) */
    sourceName: text("source_name"),
    ...timestamps,
  },
  (t) => [index("movements_item_idx").on(t.itemId), index("movements_created_idx").on(t.createdAt)],
);

/**
 * Cài đặt thông báo "sắp hết hàng" của từng tài khoản.
 * Telegram: người dùng bấm link t.me/<bot>?start=<mã> → app đọc getUpdates, khớp mã (DB chỉ lưu SHA-256) rồi lưu chat id.
 */
export const notifySettings = pgTable("notify_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  telegramChatId: text("telegram_chat_id"),
  /** Tên hiển thị của chat đã kết nối (@username hoặc tên) */
  telegramName: text("telegram_name"),
  linkCodeHash: text("link_code_hash").unique(),
  linkCodeExpiresAt: timestamp("link_code_expires_at", { withTimezone: true }),
  /** Gửi email tới địa chỉ Google của tài khoản */
  emailEnabled: boolean("email_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Trợ lý chat (LLM tự host, dùng bộ tool MCP)                         */
/* ------------------------------------------------------------------ */

/** Lệnh gọi tool trong 1 tin nhắn của trợ lý (định dạng OpenAI: arguments là chuỗi JSON) */
export type ChatToolCall = { id: string; name: string; arguments: string };
export type ChatRole = "user" | "assistant" | "tool";
/** Kết quả tool: ok / lỗi / người dùng từ chối (thao tác ghi cần xác nhận) */
export type ChatToolStatus = "ok" | "error" | "rejected";

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_conversations_user_idx").on(t.userId, t.updatedAt)],
);

/**
 * Tin nhắn theo đúng thứ tự gửi cho LLM. Lệnh gọi tool ghi chưa có dòng "tool" tương ứng
 * = đang chờ người dùng xác nhận.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    role: text("role").$type<ChatRole>().notNull(),
    content: text("content"),
    toolCalls: jsonb("tool_calls").$type<ChatToolCall[]>(),
    /** role = tool: trả lời cho lệnh gọi nào */
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    toolStatus: text("tool_status").$type<ChatToolStatus>(),
    ...timestamps,
  },
  (t) => [index("chat_messages_conversation_idx").on(t.conversationId, t.id)],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  items: many(items),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  parent: one(locations, {
    fields: [locations.parentId],
    references: [locations.id],
    relationName: "location_parent",
  }),
  children: many(locations, { relationName: "location_parent" }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  category: one(categories, { fields: [items.categoryId], references: [categories.id] }),
  location: one(locations, { fields: [items.locationId], references: [locations.id] }),
  cover: one(media, {
    fields: [items.coverMediaId],
    references: [media.id],
    relationName: "item_cover",
  }),
  media: many(media, { relationName: "item_media" }),
  movements: many(stockMovements),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  item: one(items, {
    fields: [media.itemId],
    references: [items.id],
    relationName: "item_media",
  }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  item: one(items, { fields: [stockMovements.itemId], references: [items.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  identities: many(authIdentities),
  items: many(items),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Media = typeof media.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type ItemKind = (typeof itemKind.enumValues)[number];
export type MovementType = (typeof movementType.enumValues)[number];
export type NotifySettings = typeof notifySettings.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
