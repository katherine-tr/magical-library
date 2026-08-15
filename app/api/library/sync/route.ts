import { NextRequest, NextResponse } from "next/server";
import { currentUser, database } from "../../../auth";

type SyncBook = { id: string; updatedAt?: string; createdAt?: string; [key: string]: unknown };
type Deletion = { id: string; deletedAt: string };

function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
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
  return NextResponse.json(await readLibrary(user.id));
}

export async function POST(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  let body: { books?: unknown; deletions?: unknown; order?: unknown; orderUpdatedAt?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректные данные" }, { status: 400 }); }
  const books = Array.isArray(body.books) ? body.books.filter((value): value is SyncBook => Boolean(value) && typeof value === "object" && typeof (value as SyncBook).id === "string").slice(0, 10_000) : [];
  const deletions = Array.isArray(body.deletions) ? body.deletions.filter((value): value is Deletion => Boolean(value) && typeof value === "object" && typeof (value as Deletion).id === "string" && typeof (value as Deletion).deletedAt === "string").slice(0, 10_000) : [];
  const statements: D1PreparedStatement[] = [];

  for (const book of books) {
    const updatedAt = timestamp(book.updatedAt) || timestamp(book.createdAt) || Date.now();
    const safeBook = { ...book, updatedAt: new Date(updatedAt).toISOString() };
    const data = JSON.stringify(safeBook);
    if (data.length > 2_000_000) continue;
    statements.push(database().prepare(`INSERT INTO books (user_id, id, data, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL)
      ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted_at = NULL
      WHERE excluded.updated_at >= books.updated_at AND (books.deleted_at IS NULL OR excluded.updated_at >= books.deleted_at)`)
      .bind(user.id, book.id.slice(0, 200), data, updatedAt));
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
