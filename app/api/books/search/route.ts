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
  source: "Google Books" | "Open Library" | "ЛитРес";
};

type LitresResponse = {
  success?: boolean;
  error_code?: number;
  create_sid?: { success?: boolean; sid?: string };
  search_arts?: { success?: boolean; error_code?: number; arts?: Array<Record<string, unknown>> };
};

let litresSid: string | undefined;
let litresSidPromise: Promise<string> | undefined;
let lastLitresRequestTime = 0;

function plainText(value: unknown) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function litresCredentials() {
  const app = process.env.LITRES_APP_ID?.trim();
  const secret = process.env.LITRES_SECRET_KEY?.trim();
  return app && secret ? { app, secret } : undefined;
}

function nextLitresRequestTime() {
  const now = Date.now();
  lastLitresRequestTime = Math.max(now, lastLitresRequestTime + 1);
  return new Date(lastLitresRequestTime).toISOString();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function litresApi(requests: Array<Record<string, unknown>>, sid?: string): Promise<LitresResponse> {
  const credentials = litresCredentials();
  if (!credentials) throw new Error("LitRes credentials are not configured");
  const time = nextLitresRequestTime();
  const payload = {
    app: credentials.app,
    time,
    sha: await sha256(`${time}${credentials.secret}`),
    ...(sid ? { sid } : {}),
    uilang: "rus",
    requests,
  };
  const body = new URLSearchParams({ jdata: JSON.stringify(payload) });
  const response = await fetch("https://catalit.litres.ru/catalitv2", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("LitRes unavailable");
  return response.json() as Promise<LitresResponse>;
}

async function createLitresSid() {
  const data = await litresApi([{
    func: "w_create_sid",
    id: "create_sid",
    param: { login: "Anonymous", pwd: "0" },
  }]);
  const sid = data.create_sid?.sid;
  if (!data.success || !data.create_sid?.success || !sid) throw new Error("LitRes session unavailable");
  litresSid = sid;
  return sid;
}

async function getLitresSid() {
  if (litresSid) return litresSid;
  litresSidPromise ??= createLitresSid().finally(() => { litresSidPromise = undefined; });
  return litresSidPromise;
}

function litresCover(id: string) {
  const digits = id.replace(/\D/g, "");
  const server = digits.length > 1 ? digits.at(-2) : "0";
  return `https://cv${server}.litres.ru/pub/c/cover_415/${encodeURIComponent(id)}.jpg`;
}

function litresAuthors(art: Record<string, unknown>) {
  const persons = Array.isArray(art.persons) ? art.persons as Array<Record<string, unknown>> : [];
  const authors = persons.filter((person) => String(person.type) === "1").map((person) => plainText(person.full_name)).filter(Boolean);
  return authors.length ? authors : persons.map((person) => plainText(person.full_name)).filter(Boolean).slice(0, 3);
}

function normalizeLitresResults(data: LitresResponse): SearchResult[] {
  return (data.search_arts?.arts || []).map((art) => {
    const id = plainText(art.id);
    const genres = Array.isArray(art.genres) ? art.genres as Array<Record<string, unknown>> : [];
    return {
      id: `litres:${id}`,
      title: plainText(art.title),
      authors: litresAuthors(art),
      description: plainText(art.annotation),
      cover: id ? litresCover(id) : undefined,
      genres: genres.map((genre) => plainText(genre.name)).filter(Boolean).slice(0, 4),
      year: plainText(art.year || art.first_time_sale || art.year_written).slice(0, 4) || undefined,
      language: plainText(art.lang) || undefined,
      source: "ЛитРес" as const,
    };
  }).filter((book) => book.id !== "litres:" && book.title);
}

async function litresBooks(query: string): Promise<SearchResult[]> {
  if (query.length < 3 || !litresCredentials()) return [];
  const search = async (sid: string) => litresApi([{
    func: "r_search_arts",
    id: "search_arts",
    param: { q: query, strict: "no", limit: ["0", "12"], anno: "1" },
  }], sid);
  let data = await search(await getLitresSid());
  if (data.error_code === 101000 || data.search_arts?.error_code === 101000) {
    litresSid = undefined;
    data = await search(await getLitresSid());
  }
  if (!data.success || !data.search_arts?.success) throw new Error("LitRes search unavailable");
  return normalizeLitresResults(data);
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
    const [google, fallback, litres] = await Promise.all([
      googleBooks(query).catch(() => []),
      openLibrary(query).catch(() => []),
      litresBooks(query).catch(() => []),
    ]);
    const seen = new Set<string>();
    const combined = Array.from({ length: Math.max(google.length, fallback.length, litres.length) }, (_, index) => [google[index], litres[index], fallback[index]]).flat().filter((book): book is SearchResult => Boolean(book));
    const results = combined.filter((book) => {
      const key = `${book.title}|${book.authors[0] || ""}|${book.year || ""}`.toLocaleLowerCase();
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 20);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "Каталог временно недоступен" }, { status: 502 });
  }
}
