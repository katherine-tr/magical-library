export type CatalogRecord = {
  title: string;
  author: string;
  description: string;
  cover?: string;
  genre: string;
  year: string;
  language?: string;
  source: string;
  externalId?: string;
};

export function normalizeCatalogValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

export function catalogKey(title: string, author: string): string {
  return `${normalizeCatalogValue(title)}\u0000${normalizeCatalogValue(author)}`;
}

export function sharedCoverUrl(cover: string | undefined, ownerId: string): string | undefined {
  if (!cover) return undefined;
  const match = /^\/api\/covers\/([a-f0-9-]+\.(?:jpg|png|webp))$/i.exec(cover);
  return match ? `/api/books/covers/${encodeURIComponent(ownerId)}/${encodeURIComponent(match[1])}` : cover;
}

export function catalogRecordFromBook(book: Record<string, unknown>, ownerId: string): CatalogRecord | undefined {
  const title = clean(book.title, 500);
  if (!title) return undefined;
  return {
    title,
    author: clean(book.author, 500),
    description: clean(book.description, 20_000),
    cover: sharedCoverUrl(clean(book.cover, 2_000) || undefined, ownerId),
    genre: clean(book.genre, 500),
    year: clean(book.year, 20),
    language: clean(book.language, 50) || undefined,
    source: clean(book.catalogSource, 100) || "Пользователь",
    externalId: clean(book.catalogExternalId, 500) || undefined,
  };
}

function clean(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximumLength) : "";
}
