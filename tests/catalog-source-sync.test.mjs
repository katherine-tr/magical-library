import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("editing one personal card moves its catalog source and removes the orphaned revision", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE catalog_books (
      id TEXT PRIMARY KEY, title_key TEXT NOT NULL, author_key TEXT NOT NULL,
      created_by TEXT REFERENCES users(id), UNIQUE(title_key, author_key)
    );
    CREATE TABLE catalog_book_sources (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL,
      catalog_book_id TEXT NOT NULL REFERENCES catalog_books(id) ON DELETE CASCADE,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, book_id)
    );
    INSERT INTO users VALUES ('user-1');
    INSERT INTO catalog_books VALUES ('old', 'книга', '', 'user-1');
    INSERT INTO catalog_book_sources VALUES ('user-1', 'card-1', 'old', 1);
    INSERT INTO catalog_books VALUES ('new', 'книга', 'автор', 'user-1');
  `);

  db.prepare(`INSERT INTO catalog_book_sources (user_id, book_id, catalog_book_id, updated_at)
    SELECT ?1, ?2, id, ?5 FROM catalog_books WHERE title_key = ?3 AND author_key = ?4
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      catalog_book_id = excluded.catalog_book_id, updated_at = excluded.updated_at`)
    .run('user-1', 'card-1', 'книга', 'автор', 2);
  db.prepare(`DELETE FROM catalog_books WHERE id = ?1 AND created_by = ?2
    AND NOT EXISTS (SELECT 1 FROM catalog_book_sources WHERE catalog_book_id = ?1)`)
    .run('old', 'user-1');

  assert.deepEqual(db.prepare("SELECT id FROM catalog_books ORDER BY id").all().map((row) => row.id), ["new"]);
  assert.equal(db.prepare("SELECT catalog_book_id AS catalogBookId FROM catalog_book_sources").get().catalogBookId, "new");
});
