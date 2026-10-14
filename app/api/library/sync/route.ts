import { NextRequest, NextResponse } from "next/server";
import { currentUser, database } from "../../../auth";
import { catalogRecordFromBook, normalizeCatalogValue } from "../../../book-catalog";

type SyncBook = { id: string; updatedAt?: string; createdAt?: string; [key: string]: unknown };
type Deletion = { id: string; deletedAt: string };
type CatalogSourceRow = { bookId: string; catalogBookId: string };

function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function catalogSourceMap(userId: string): Promise<Map<string, string>> {
  const rows = await database().prepare(`SELECT book_id AS bookId, catalog_book_id AS catalogBookId
    FROM catalog_book_sources WHERE user_id = ?1`).bind(userId).all<CatalogSourceRow>();
  return new Map(rows.results.map((row) => [row.bookId, row.catalogBookId]));
}

function catalogSyncStatements(userId: string, book: SyncBook, updatedAt: number, previousCatalogId?: string): D1PreparedStatement[] {
  const catalogBook = catalogRecordFromBook(book, userId);
  if (!catalogBook) return [];
  const titleKey = normalizeCatalogValue(catalogBook.title);
  const authorKey = normalizeCatalogValue(catalogBook.author);
  const statements: D1PreparedStatement[] = [];

  // An early draft can be saved before its author is filled in. Once the same
  // user completes that card, remove only the completely empty draft instead
  // of leaving it beside the finished title in the shared catalog.
  if (authorKey) {
    statements.push(database().prepare(`DELETE FROM catalog_books
      WHERE created_by = ?1 AND title_key = ?2 AND author_key = ''
        AND description = '' AND (cover IS NULL OR cover = '') AND genre = '' AND year = ''`)
      .bind(userId, titleKey));
  }

  statements.push(database().prepare(`INSERT INTO catalog_books
    (id, title, author, title_key, author_key, description, cover, genre, year, language, source, external_id, created_by, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
    ON CONFLICT(title_key, author_key) DO UPDATE SET
      title = CASE WHEN catalog_books.created_by = excluded.created_by THEN excluded.title ELSE catalog_books.title END,
      author = CASE WHEN catalog_books.created_by = excluded.created_by THEN excluded.author ELSE catalog_books.author END,
      description = CASE WHEN catalog_books.created_by = excluded.created_by OR catalog_books.description = '' THEN excluded.description ELSE catalog_books.description END,
      cover = CASE WHEN catalog_books.created_by = excluded.created_by OR catalog_books.cover IS NULL OR catalog_books.cover = '' THEN excluded.cover ELSE catalog_books.cover END,
      genre = CASE WHEN catalog_books.created_by = excluded.created_by OR catalog_books.genre = '' THEN excluded.genre ELSE catalog_books.genre END,
      year = CASE WHEN catalog_books.created_by = excluded.created_by OR catalog_books.year = '' THEN excluded.year ELSE catalog_books.year END,
      language = CASE WHEN catalog_books.created_by = excluded.created_by OR catalog_books.language IS NULL OR catalog_books.language = '' THEN excluded.language ELSE catalog_books.language END,
      source = CASE WHEN catalog_books.created_by = excluded.created_by THEN excluded.source ELSE catalog_books.source END,
      external_id = CASE WHEN catalog_books.created_by = excluded.created_by OR catalog_books.external_id IS NULL THEN excluded.external_id ELSE catalog_books.external_id END,
      updated_at = MAX(catalog_books.updated_at, excluded.updated_at)`)
    .bind(
      crypto.randomUUID(), catalogBook.title, catalogBook.author,
      titleKey, authorKey,
      catalogBook.description, catalogBook.cover || null, catalogBook.genre, catalogBook.year,
      catalogBook.language || null, catalogBook.source, catalogBook.externalId || null,
      userId, updatedAt,
    ));

  // The personal card id is stable across edits. Point it at the canonical
  // title+author row so changing either field moves the same source instead of
  // creating an unrelated catalog contribution.
  statements.push(database().prepare(`INSERT INTO catalog_book_sources
    (user_id, book_id, catalog_book_id, updated_at)
    SELECT ?1, ?2, id, ?5 FROM catalog_books WHERE title_key = ?3 AND author_key = ?4
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      catalog_book_id = excluded.catalog_book_id,
      updated_at = excluded.updated_at`)
    .bind(userId, book.id.slice(0, 200), titleKey, authorKey, updatedAt));

  if (previousCatalogId) {
    statements.push(database().prepare(`DELETE FROM catalog_books
      WHERE id = ?1 AND created_by = ?2
        AND NOT EXISTS (
          SELECT 1 FROM catalog_book_sources WHERE catalog_book_id = ?1
        )`).bind(previousCatalogId, userId));
  }
  return statements;
}

async function readLibrary(userId: string) {
  const rows = await database().prepare("SELECT id, data, updated_at AS updatedAt FROM books WHERE user_id = ?1 AND deleted_at IS NULL")
    .bind(userId).all<{ id: string; data: string; updatedAt: number }>();
  const state = await database().prepare("SELECT order_json AS orderJson, order_updated_at AS orderUpdatedAt FROM library_state WHERE user_id = ?1")
    .bind(userId).first<{ orderJson: string; orderUpdatedAt: number }>();
  const books = rows.results.flatMap((row) => { try { return [{ ...JSON.parse(row.data), id: row.id, updatedAt: new Date(row.updatedAt).toISOString() }]; } catch { return []; } });
  const order = (() => { try { return JSON.parse(state?.orderJson || "[]") as string[]; } catch { return []; } })();
  const byId = new Map(books.map((book) => [book.id, book]));
  const ordered = order.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  const orderedIds = new Set(order);
  ordered.push(...books.filter((book) => !orderedIds.has(book.id)));
  return { books: ordered, orderUpdatedAt: new Date(state?.orderUpdatedAt || 0).toISOString() };
}

export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const library = await readLibrary(user.id);
  const sources = await catalogSourceMap(user.id);
  const catalogStatements = library.books.flatMap((book) => {
    const updatedAt = timestamp(book.updatedAt) || Date.now();
    return catalogSyncStatements(user.id, book as SyncBook, updatedAt, sources.get(book.id));
  });
  if (catalogStatements.length) await database().batch(catalogStatements);
  return NextResponse.json(library);
}

export async function POST(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  let body: { books?: unknown; deletions?: unknown; order?: unknown; orderUpdatedAt?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректные данные" }, { status: 400 }); }
  const books = Array.isArray(body.books) ? body.books.filter((value): value is SyncBook => Boolean(value) && typeof value === "object" && typeof (value as SyncBook).id === "string").slice(0, 10_000) : [];
  const deletions = Array.isArray(body.deletions) ? body.deletions.filter((value): value is Deletion => Boolean(value) && typeof value === "object" && typeof (value as Deletion).id === "string" && typeof (value as Deletion).deletedAt === "string").slice(0, 10_000) : [];
  const statements: D1PreparedStatement[] = [];
  const sources = books.length ? await catalogSourceMap(user.id) : new Map<string, string>();

  for (const book of books) {
    const updatedAt = timestamp(book.updatedAt) || timestamp(book.createdAt) || Date.now();
    const safeBook = { ...book, updatedAt: new Date(updatedAt).toISOString() };
    const data = JSON.stringify(safeBook);
    if (data.length > 2_000_000) continue;
    statements.push(database().prepare(`INSERT INTO books (user_id, id, data, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL)
      ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted_at = NULL
      WHERE excluded.updated_at >= books.updated_at AND (books.deleted_at IS NULL OR excluded.updated_at >= books.deleted_at)`)
      .bind(user.id, book.id.slice(0, 200), data, updatedAt));
    statements.push(...catalogSyncStatements(user.id, book, updatedAt, sources.get(book.id)));
  }
  for (const deletion of deletions) {
    const deletedAt = timestamp(deletion.deletedAt) || Date.now();
    statements.push(database().prepare(`INSERT INTO books (user_id, id, data, updated_at, deleted_at) VALUES (?1, ?2, '{}', 0, ?3)
      ON CONFLICT(user_id, id) DO UPDATE SET deleted_at = excluded.deleted_at
      WHERE excluded.deleted_at >= books.updated_at AND (books.deleted_at IS NULL OR excluded.deleted_at >= books.deleted_at)`)
      .bind(user.id, deletion.id.slice(0, 200), deletedAt));
  }
  const order = Array.isArray(body.order) ? body.order.filter((id): id is string => typeof id === "string").slice(0, 10_000) : [];
  const orderUpdatedAt = timestamp(body.orderUpdatedAt);
  if (orderUpdatedAt) statements.push(database().prepare(`INSERT INTO library_state (user_id, order_json, order_updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id) DO UPDATE SET order_json = excluded.order_json, order_updated_at = excluded.order_updated_at
    WHERE excluded.order_updated_at >= library_state.order_updated_at`).bind(user.id, JSON.stringify(order), orderUpdatedAt));
  if (statements.length) await database().batch(statements);
  return NextResponse.json(await readLibrary(user.id));
}
