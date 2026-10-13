import assert from "node:assert/strict";
import test from "node:test";
import { catalogKey, catalogRecordFromBook, sharedCoverUrl } from "../app/book-catalog.ts";

test("catalog duplicates use only normalized exact title and author", () => {
  assert.equal(catalogKey("  Война   и мир ", "Лев Толстой"), catalogKey("война и мир", "лев толстой"));
  assert.notEqual(catalogKey("Война и мир", "Лев Толстой"), catalogKey("Война и мир", "Л. Толстой"));
  assert.notEqual(catalogKey("Война и мир", ""), catalogKey("Война и мир", "Лев Толстой"));
});

test("shared catalog record contains metadata but no private reading data", () => {
  const record = catalogRecordFromBook({
    title: "Книга",
    author: "Автор",
    description: "Описание",
    cover: "/api/covers/123e4567-e89b-12d3-a456-426614174000.webp",
    genre: "Роман",
    year: "2025",
    status: "reading",
    journal: [{ comment: "Личное" }],
    catalogSource: "ЛитРес",
  }, "123e4567-e89b-12d3-a456-426614174001");

  assert.deepEqual(record, {
    title: "Книга",
    author: "Автор",
    description: "Описание",
    cover: "/api/books/covers/123e4567-e89b-12d3-a456-426614174001/123e4567-e89b-12d3-a456-426614174000.webp",
    genre: "Роман",
    year: "2025",
    language: undefined,
    source: "ЛитРес",
    externalId: undefined,
  });
  assert.equal("journal" in record, false);
  assert.equal("status" in record, false);
});

test("remote covers remain unchanged", () => {
  assert.equal(sharedCoverUrl("https://example.com/cover.jpg", "owner"), "https://example.com/cover.jpg");
});
