import { NextRequest, NextResponse } from "next/server";

type SearchResult = {
  id: string;
  title: string;
  authors: string[];
  description: string;
  cover?: string;
  genres: string[];
  year?: string;
  language?: string;
  source: "Google Books" | "Open Library";
};

function plainText(value: unknown) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function googleBooks(query: string): Promise<SearchResult[]> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("printType", "books");
  url.searchParams.set("maxResults", "20");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error("Google Books unavailable");
  const data = await response.json() as { items?: Array<{ id: string; volumeInfo?: Record<string, unknown> }> };
  return (data.items || []).map((item) => {
    const info = item.volumeInfo || {};
    const images = (info.imageLinks || {}) as Record<string, string>;
    return {
      id: `google:${item.id}`,
      title: plainText(info.title),
      authors: Array.isArray(info.authors) ? info.authors.map(plainText) : [],
      description: plainText(info.description),
      cover: (images.extraLarge || images.large || images.medium || images.thumbnail || "").replace(/^http:/, "https:") || undefined,
      genres: Array.isArray(info.categories) ? info.categories.map(plainText) : [],
      year: plainText(info.publishedDate).slice(0, 4) || undefined,
      language: plainText(info.language) || undefined,
      source: "Google Books" as const,
    };
  }).filter((book) => book.title);
}

async function openLibrary(query: string): Promise<SearchResult[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,cover_i,subject,language");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "EnchantedLibrary/1.0" }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error("Open Library unavailable");
  const data = await response.json() as { docs?: Array<Record<string, unknown>> };
  return (data.docs || []).map((doc) => ({
    id: `openlibrary:${plainText(doc.key)}`,
    title: plainText(doc.title),
    authors: Array.isArray(doc.author_name) ? doc.author_name.map(plainText) : [],
    description: "",
    cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined,
    genres: Array.isArray(doc.subject) ? doc.subject.slice(0, 4).map(plainText) : [],
    year: plainText(doc.first_publish_year) || undefined,
    language: Array.isArray(doc.language) ? plainText(doc.language[0]) : undefined,
    source: "Open Library" as const,
  })).filter((book) => book.title);
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 2) return NextResponse.json({ results: [], error: "Введите хотя бы 2 символа" }, { status: 400 });
  try {
    const [google, fallback] = await Promise.all([
      googleBooks(query).catch(() => []),
      openLibrary(query).catch(() => []),
    ]);
    const seen = new Set<string>();
    const results = [...google, ...fallback].filter((book) => {
      const key = `${book.title}|${book.authors[0] || ""}|${book.year || ""}`.toLocaleLowerCase();
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 20);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "Каталог временно недоступен" }, { status: 502 });
  }
}
