import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_users_username").on(table.username)]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_sessions_user_id").on(table.userId), index("idx_sessions_expires_at").on(table.expiresAt)]);

export const books = sqliteTable("books", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("idx_books_user_updated").on(table.userId, table.updatedAt),
]);

export const catalogBooks = sqliteTable("catalog_books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  titleKey: text("title_key").notNull(),
  authorKey: text("author_key").notNull(),
  description: text("description").notNull().default(""),
  cover: text("cover"),
  genre: text("genre").notNull().default(""),
  year: text("year").notNull().default(""),
  language: text("language"),
  source: text("source").notNull().default("Пользователь"),
  externalId: text("external_id"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_catalog_books_title_author").on(table.titleKey, table.authorKey),
  index("idx_catalog_books_title_key").on(table.titleKey),
  index("idx_catalog_books_author_key").on(table.authorKey),
]);

export const libraryState = sqliteTable("library_state", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  orderJson: text("order_json").notNull().default("[]"),
  orderUpdatedAt: integer("order_updated_at").notNull().default(0),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
});
