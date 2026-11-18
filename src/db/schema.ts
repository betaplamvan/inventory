import {
  type AnyPgColumn,
  bigint,
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
import { relations } from "drizzle-orm";

export const itemKind = pgEnum("item_kind", [
  "component", // Linh kiện
  "module", // Module / board
  "tool", // Dụng cụ
  "consumable", // Vật tư tiêu hao
  "equipment", // Thiết bị / máy đo
  "other",
]);

export const movementType = pgEnum("movement_type", ["in", "out", "adjust"]);
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

/** Cách đăng nhập gắn với user (như okia): provider "google" + subject = Google `sub`. */
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
  },
  (t) => [
    index("items_user_idx").on(t.userId),
    uniqueIndex("items_user_sku_uq").on(t.userId, t.sku),
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
    ...timestamps,
  },
  (t) => [index("movements_item_idx").on(t.itemId), index("movements_created_idx").on(t.createdAt)],
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
