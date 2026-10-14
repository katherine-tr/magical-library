"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "home" | "library" | "reading" | "stats";
type ShelfView = "spines" | "covers";
type Status = "want" | "reading" | "read" | "paused" | "abandoned";
type Format = "paper" | "ebook" | "audio";
type BookKind = "fiction" | "nonfiction";
type Language = "ru" | "en" | "es" | "fr";

type JournalEntry = {
  id: string;
  startedAt: string;
  finishedAt: string;
  rating?: number;
  answers: Record<string, string>;
  comment: string;
  createdAt: string;
};

type CatalogBook = { id: string; title: string; authors: string[]; description: string; cover?: string; genres: string[]; year?: string; language?: string; source: string; catalogSource?: string; catalogExternalId?: string };

type Book = {
  id: string;
  title: string;
  author: string;
  description: string;
  genre: string;
  year: string;
  status: Status;
  formats: Format[];
  cover?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  readAt?: string;
  kind: BookKind;
  language?: Language;
  journal: JournalEntry[];
  catalogSource?: string;
  catalogExternalId?: string;
};

const STORAGE_KEY = "enchanted-library-v1";
const SYNC_META_KEY = "enchanted-library-sync-v1";
type SyncMeta = { deletions: Array<{ id: string; deletedAt: string }>; orderUpdatedAt: string };
const statuses: Array<[Status, string]> = [
  ["want", "Хочу прочитать"], ["reading", "Читаю"], ["read", "Прочитано"],
  ["paused", "Отложено"], ["abandoned", "Брошено"],
];
const languages: Array<[Language, string]> = [
  ["ru", "Русский"], ["en", "Английский"], ["es", "Испанский"], ["fr", "Французский"],
];
const colors = ["#385b73", "#704d68", "#586c50", "#77584b", "#4c4c78", "#795a30"];

const emptySyncMeta = (): SyncMeta => ({ deletions: [], orderUpdatedAt: new Date(0).toISOString() });
const accountKey = (base: string, username: string) => `${base}:${username.toLocaleLowerCase("en")}`;

function loadBooks(username: string): Book[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(accountKey(STORAGE_KEY, username)) || "[]") as Array<Partial<Book> & Pick<Book, "id" | "title">>;
    return saved.map((book) => ({
      author: "", description: "", genre: "", year: "", status: "want", formats: [], color: colors[0], createdAt: new Date().toISOString(),
      ...book, updatedAt: book.updatedAt || book.createdAt || new Date().toISOString(), kind: book.kind || "fiction", journal: Array.isArray(book.journal) ? book.journal : [],
    })) as Book[];
  } catch { return []; }
}

function loadSyncMeta(username: string): SyncMeta {
  if (typeof window === "undefined") return emptySyncMeta();
  try {
    const saved = JSON.parse(localStorage.getItem(accountKey(SYNC_META_KEY, username)) || "{}") as Partial<SyncMeta>;
    return { deletions: Array.isArray(saved.deletions) ? saved.deletions : [], orderUpdatedAt: saved.orderUpdatedAt || new Date(0).toISOString() };
  } catch { return emptySyncMeta(); }
}

export function LibraryApp() {
  const [view, setView] = useState<View>("home");
  const [books, setBooks] = useState<Book[]>([]);
  const [shelfView, setShelfView] = useState<ShelfView>("spines");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [sort, setSort] = useState<"manual" | "title" | "author" | "year">("manual");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Book | null>(null);
  const [authState, setAuthState] = useState<"loading" | "signed-out" | "signed-in">("loading");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "offline">("idle");
  const booksRef = useRef(books);
  const metaRef = useRef<SyncMeta>(emptySyncMeta());
  const usernameRef = useRef<string | null>(null);
  const authRef = useRef(false);
  const syncingRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    booksRef.current = books;
    if (usernameRef.current) localStorage.setItem(accountKey(STORAGE_KEY, usernameRef.current), JSON.stringify(books));
  }, [books]);
  const saveMeta = (meta: SyncMeta) => {
    metaRef.current = meta;
    if (usernameRef.current) localStorage.setItem(accountKey(SYNC_META_KEY, usernameRef.current), JSON.stringify(meta));
  };

  const openAccount = async (username: string) => {
    const normalizedUsername = username.trim().toLocaleLowerCase("en");
    usernameRef.current = normalizedUsername;
    authRef.current = true;
    dirtyRef.current = false;
    setAuthState("loading");
    setSyncState("syncing");
    try {
      const response = await fetch("/api/library/sync");
      if (response.status === 401) { authRef.current = false; usernameRef.current = null; setAuthState("signed-out"); return; }
      if (!response.ok) throw new Error("sync failed");
      const result = await response.json() as { books: Book[]; orderUpdatedAt: string };
      const nextMeta = { deletions: [], orderUpdatedAt: result.orderUpdatedAt };
      booksRef.current = result.books;
      metaRef.current = nextMeta;
      localStorage.setItem(accountKey(STORAGE_KEY, normalizedUsername), JSON.stringify(result.books));
      localStorage.setItem(accountKey(SYNC_META_KEY, normalizedUsername), JSON.stringify(nextMeta));
      setBooks(result.books);
      setSyncState("idle");
    } catch {
      const cachedBooks = loadBooks(normalizedUsername);
      const cachedMeta = loadSyncMeta(normalizedUsername);
      booksRef.current = cachedBooks;
      metaRef.current = cachedMeta;
      setBooks(cachedBooks);
      setSyncState("offline");
    }
    setAuthState("signed-in");
  };

  const flushSync = async () => {
    if (!authRef.current || syncingRef.current) return;
    syncingRef.current = true;
    try {
      while (dirtyRef.current && authRef.current) {
        dirtyRef.current = false;
        setSyncState("syncing");
        let snapshot = booksRef.current;
        const uploaded = await Promise.all(snapshot.map(async (book) => {
          if (!book.cover?.startsWith("data:image/")) return book;
          const response = await fetch("/api/covers", { method: "POST", body: JSON.stringify({ dataUrl: book.cover }), headers: { "Content-Type": "application/json" } });
          if (!response.ok) throw new Error("cover upload failed");
          const result = await response.json() as { url: string };
          return { ...book, cover: result.url };
        }));
        if (uploaded.some((book, index) => book !== snapshot[index])) {
          snapshot = uploaded;
          booksRef.current = uploaded;
          setBooks(uploaded);
        }
        const metaSnapshot = metaRef.current;
        const response = await fetch("/api/library/sync", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ books: snapshot, deletions: metaSnapshot.deletions, order: snapshot.map((book) => book.id), orderUpdatedAt: metaSnapshot.orderUpdatedAt }),
        });
        if (response.status === 401) { authRef.current = false; setAuthState("signed-out"); return; }
        if (!response.ok) throw new Error("sync failed");
        const result = await response.json() as { books: Book[]; orderUpdatedAt: string };
        const completedDeletions = new Map(metaSnapshot.deletions.map((item) => [item.id, item.deletedAt]));
        saveMeta({
          deletions: metaRef.current.deletions.filter((item) => completedDeletions.get(item.id) !== item.deletedAt),
          orderUpdatedAt: Date.parse(metaRef.current.orderUpdatedAt) > Date.parse(result.orderUpdatedAt) ? metaRef.current.orderUpdatedAt : result.orderUpdatedAt,
        });
        if (!dirtyRef.current) { booksRef.current = result.books; setBooks(result.books); }
      }
      setSyncState("idle");
    } catch {
      setSyncState("offline");
      dirtyRef.current = true;
    } finally { syncingRef.current = false; }
  };
  const requestSync = () => { dirtyRef.current = true; window.setTimeout(() => void flushSync(), 80); };

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session").then(async (response) => {
      if (!active) return;
      if (response.ok) {
        const result = await response.json() as { user: { username: string } };
        if (active) await openAccount(result.user.username);
      }
      else setAuthState("signed-out");
    }).catch(() => active && setAuthState("signed-out"));
    const refresh = () => { if (!document.hidden && authRef.current) requestSync(); };
    window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- synchronization uses refs to avoid stale state

  const shownBooks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const next = books.filter((book) => (status === "all" || book.status === status) &&
      (!needle || `${book.title} ${book.author} ${book.genre}`.toLocaleLowerCase("ru").includes(needle)));
    if (sort === "manual") return next;
    return [...next].sort((a, b) => (a[sort] || "").localeCompare(b[sort] || "", "ru", { numeric: true }));
  }, [books, query, status, sort]);

  const reading = books.filter((book) => book.status === "reading");
  const paused = books.filter((book) => book.status === "paused");
  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const commitBooks = (next: Book[], orderChanged = false) => {
    booksRef.current = next; setBooks(next);
    if (orderChanged) saveMeta({ ...metaRef.current, orderUpdatedAt: new Date().toISOString() });
    requestSync();
  };
  const addBook = (book: Book) => { const now = new Date().toISOString(); commitBooks([{ ...book, updatedAt: now, readAt: book.status === "read" ? now : undefined }, ...booksRef.current], true); setAdding(false); setView("library"); };
  const updateBook = (book: Book) => {
    const now = new Date().toISOString();
    const existing = booksRef.current.find((item) => item.id === book.id);
    const readAt = book.status === "read" ? (existing?.status === "read" ? book.readAt || existing.readAt || existing.updatedAt || now : now) : undefined;
    const nextBook = { ...book, updatedAt: now, readAt };
    commitBooks(booksRef.current.map((item) => item.id === book.id ? nextBook : item)); setSelected(nextBook);
  };
  const deleteBook = (id: string) => { if (confirm("Удалить книгу из библиотеки?")) { const deletedAt = new Date().toISOString(); saveMeta({ ...metaRef.current, deletions: [...metaRef.current.deletions.filter((item) => item.id !== id), { id, deletedAt }] }); commitBooks(booksRef.current.filter((book) => book.id !== id), true); setSelected(null); } };
  const saveVisibleOrder = (ordered: Book[]) => {
    const visibleIds = new Set(ordered.map((book) => book.id));
    let index = 0; commitBooks(booksRef.current.map((book) => visibleIds.has(book.id) ? ordered[index++] : book), true);
  };
  const dropBook = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return; const ordered = [...shownBooks]; const from = ordered.findIndex((book) => book.id === draggedId); const to = ordered.findIndex((book) => book.id === targetId); if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved); saveVisibleOrder(ordered); setSort("manual");
  };

  if (authState === "loading") return <div className="auth-screen"><div className="auth-card"><span className="brand-mark">✦</span><p>Открываем библиотеку…</p></div></div>;
  if (authState === "signed-out") return <LoginScreen onSignedIn={openAccount} />;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    authRef.current = false; usernameRef.current = null; dirtyRef.current = false;
    booksRef.current = []; metaRef.current = emptySyncMeta(); setBooks([]); setAuthState("signed-out");
  };
  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => navigate("home")} aria-label="На главную">
        <span className="brand-mark">✦</span><span className="brand-copy">Зачарованная библиотека</span>
      </button>
      <nav className="desktop-nav" aria-label="Основная навигация">
        <NavButton active={view === "home"} onClick={() => navigate("home")}>Главная</NavButton>
        <NavButton active={view === "library"} onClick={() => navigate("library")}>Библиотека</NavButton>
        <NavButton active={view === "reading"} onClick={() => navigate("reading")}>Сейчас читаю</NavButton>
        <NavButton active={view === "stats"} onClick={() => navigate("stats")}>Статистика</NavButton>
      </nav>
      <div className="account-actions"><span className={`sync-status ${syncState}`}>{syncState === "syncing" ? "Синхронизация…" : syncState === "offline" ? "Сохраним при подключении" : "Синхронизировано"}</span><button className="primary-button" onClick={() => setAdding(true)}>＋ Добавить книгу</button><button className="icon-button" onClick={logout} aria-label="Выйти" title="Выйти">↪</button></div>
    </header>

    {view === "home" && <Home books={books} onLibrary={() => navigate("library")} onAdd={() => setAdding(true)} />}
    {view === "library" && <section className="page">
      <div className="page-heading"><div><span className="eyebrow">Моё пространство</span><h1>Книжные полки</h1><p>{books.length ? `${books.length} ${bookWord(books.length)} в вашей библиотеке` : "Здесь появятся книги, к которым хочется возвращаться."}</p></div></div>
      <div className="toolbar">
        <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти книгу или автора…" aria-label="Поиск по библиотеке" />
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | "all")} aria-label="Фильтр по статусу"><option value="all">Все статусы</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка"><option value="manual">Мой порядок</option><option value="title">По названию</option><option value="author">По автору</option><option value="year">По году</option></select>
        <div className="view-toggle" aria-label="Вид библиотеки"><button className={shelfView === "spines" ? "active" : ""} onClick={() => setShelfView("spines")}>Корешки</button><button className={shelfView === "covers" ? "active" : ""} onClick={() => setShelfView("covers")}>Обложки</button></div>
      </div>
      {!shownBooks.length ? <EmptyLibrary hasBooks={!!books.length} onAdd={() => setAdding(true)} /> : shelfView === "spines" ? <SpineShelf books={shownBooks} onOpen={setSelected} canReorder onDropBook={dropBook} /> : <CoverShelf books={shownBooks} onOpen={setSelected} canReorder onDropBook={dropBook} />}
    </section>}
    {view === "reading" && <ReadingPage books={reading} pausedBooks={paused} onOpen={setSelected} onAdd={() => setAdding(true)} />}
    {view === "stats" && <StatsPage books={books} onOpen={setSelected} />}

    <nav className="bottom-nav" aria-label="Мобильная навигация">
      <NavButton active={view === "home"} onClick={() => navigate("home")}>⌂<br/>Главная</NavButton>
      <NavButton active={view === "library"} onClick={() => navigate("library")}>▥<br/>Полки</NavButton>
      <NavButton active={view === "reading"} onClick={() => navigate("reading")}>◫<br/>Читаю</NavButton>
      <NavButton active={view === "stats"} onClick={() => navigate("stats")}>✧<br/>Итоги</NavButton>
    </nav>
    {adding && <BookFormModal onClose={() => setAdding(false)} onSave={addBook} />}
    {selected && <BookModal book={selected} onClose={() => setSelected(null)} onDelete={() => deleteBook(selected.id)} onSave={updateBook} />}
  </main>;
}

function LoginScreen({ onSignedIn }: { onSignedIn: (username: string) => void | Promise<void> }) {
  const [username, setUsername] = useState("katherine"); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const result = await response.json() as { error?: string; user?: { username: string } };
      if (!response.ok) { setError(result.error || "Не удалось войти"); return; }
      setPassword(""); await onSignedIn(result.user?.username || username);
    } catch { setError("Нет соединения с сервером"); } finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-card"><span className="brand-mark">✦</span><span className="eyebrow">Личная библиотека</span><h1>С возвращением</h1><p>Войдите, чтобы открыть свои книжные полки</p><form onSubmit={submit}><label htmlFor="login">Логин</label><input id="login" className="field" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required/><label htmlFor="password">Пароль</label><input id="password" className="field" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "Входим…" : "Войти"}</button></form></section></main>;
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function Home({ books, onLibrary, onAdd }: { books: Book[]; onLibrary: () => void; onAdd: () => void }) {
  const reading = books.filter((book) => book.status === "reading").length;
  return <section className="page">
    <div className="hero">
      <div className="sparkles" aria-hidden="true"><span/><span/><span/><span/></div>
      <h1 className="hero-title"><span>Зачарованная</span><span>библиотека</span></h1>
      <div className="hero-copy"><p className="hero-description">Собирайте книги на волшебных полках, сохраняйте впечатления и возвращайтесь к ним спустя годы.</p><div className="hero-actions"><button className="primary-button" onClick={onLibrary}>Открыть библиотеку</button><button className="secondary-button" onClick={onAdd}>Добавить книгу</button></div><p className="hero-note">Хранитель бережёт ваши записи</p></div>
    </div>
    <div className="welcome-grid"><article className="panel"><span className="eyebrow">Закладка хранителя</span><h2>Сейчас читаю</h2><p className="empty-mini">{reading ? `${reading} ${bookWord(reading)} ждут продолжения.` : "Когда начнёте книгу, она появится здесь — с обложкой и датой начала."}</p></article><article className="panel"><span className="eyebrow">Книжная магия</span><h2>Книжные итоги</h2><div className="stat-row"><div className="stat"><strong>{books.length}</strong><span>в библиотеке</span></div><div className="stat"><strong>{books.filter((b) => b.status === "read").length}</strong><span>прочитано</span></div></div></article></div>
  </section>;
}

function EmptyLibrary({ hasBooks, onAdd }: { hasBooks: boolean; onAdd: () => void }) {
  return <div className="empty-state"><div><div className="empty-orb">✦</div><h2>{hasBooks ? "Ничего не найдено" : "Полки ждут первую книгу"}</h2><p>{hasBooks ? "Попробуйте изменить поиск или фильтр." : "Найдённые в каталогах книги и редкие издания, добавленные вручную, будут жить рядом."}</p>{!hasBooks && <button className="primary-button" onClick={onAdd}>＋ Добавить книгу</button>}</div></div>;
}

type ShelfProps = { books: Book[]; onOpen: (book: Book) => void; canReorder?: boolean; onDropBook?: (draggedId: string, targetId: string) => void };

function SpineShelf({ books, onOpen, canReorder = false, onDropBook }: ShelfProps) {
  const shelvesRef = useRef<HTMLDivElement>(null);
  const [shelfWidth, setShelfWidth] = useState(0);
  useEffect(() => {
    const element = shelvesRef.current;
    if (!element) return;
    const updateWidth = () => setShelfWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shelves = useMemo(() => splitBooksIntoShelves(books, Math.max(1, (shelfWidth || 1000) - 32)), [books, shelfWidth]);
  return <div className="shelves" ref={shelvesRef}>{shelves.map((shelf, shelfIndex) => <div className="shelf" key={`shelf-${shelfIndex}`}>{shelf.map((book) => { const size = stableSpineSize(book.id); return <DraggableBook key={book.id} book={book} canReorder={canReorder} onDropBook={onDropBook} onOpen={onOpen} className="spine-slot"><div className="spine" style={{ "--spine-color": book.color, "--spine-width": `${size.width}px`, "--spine-height": `${size.height}px` } as React.CSSProperties}>{book.title}</div></DraggableBook>; })}</div>)}</div>;
}

function splitBooksIntoShelves(books: Book[], shelfWidth: number) {
  const shelves: Book[][] = [];
  let shelf: Book[] = [];
  let usedWidth = 0;
  for (const book of books) {
    const bookWidth = stableSpineSize(book.id).width;
    const nextWidth = shelf.length ? usedWidth + 6 + bookWidth : bookWidth;
    if (shelf.length && nextWidth > shelfWidth) {
      shelves.push(shelf);
      shelf = [book];
      usedWidth = bookWidth;
    } else {
      shelf.push(book);
      usedWidth = nextWidth;
    }
  }
  if (shelf.length) shelves.push(shelf);
  return shelves;
}

function stableSpineSize(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  const value = Math.abs(hash);
  return { width: 50 + (value % 4) * 7, height: 160 + (Math.floor(value / 4) % 5) * 13 };
}

function CoverShelf({ books, onOpen, canReorder = false, onDropBook }: ShelfProps) {
  return <div className="cover-shelves"><div className="cover-grid">{books.map((book) => <DraggableBook key={book.id} book={book} canReorder={canReorder} onDropBook={onDropBook} onOpen={onOpen} className="cover-slot"><div className="cover-card"><div className="cover-art" style={{ "--cover-color": book.color } as React.CSSProperties}>{book.cover ? <img src={book.cover} alt="" /> : <span className="cover-placeholder"><span aria-hidden="true">✦</span><b>{book.title}</b></span>}</div><strong>{book.title}</strong><small>{book.author || "Автор не указан"}</small></div></DraggableBook>)}</div></div>;
}

function DraggableBook({ book, canReorder, onDropBook, onOpen, className, children }: { book: Book; canReorder: boolean; onDropBook?: (draggedId: string, targetId: string) => void; onOpen: (book: Book) => void; className: string; children: React.ReactNode }) {
  const [dragging, setDragging] = useState(false); const draggingRef = useRef(false); const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const targetId = useRef(book.id); const suppressClick = useRef(false); const origin = useRef({ x: 0, y: 0 });
  const clearTimer = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const finishTouchDrag = (element: HTMLElement) => { draggingRef.current = false; setDragging(false); element.style.removeProperty("--drag-x"); element.style.removeProperty("--drag-y"); };
  return <div data-book-id={book.id} className={`${className} ${dragging ? "dragging" : ""}`} draggable={canReorder} role="button" tabIndex={0} aria-label={`Открыть книгу «${book.title}». Зажмите и перетащите, чтобы переставить.`}
    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(book); }}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(book); }}
    onDragStart={(event) => { if (!canReorder) { event.preventDefault(); return; } suppressClick.current = true; setDragging(true); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/book-id", book.id); }}
    onDragEnd={() => setDragging(false)} onDragOver={(event) => { if (canReorder) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/book-id"); if (id) onDropBook?.(id, book.id); setDragging(false); }}
    onPointerDown={(event) => { if (!canReorder || event.pointerType === "mouse") return; const element = event.currentTarget; const pointerId = event.pointerId; origin.current = { x: event.clientX, y: event.clientY }; targetId.current = book.id; holdTimer.current = setTimeout(() => { suppressClick.current = true; draggingRef.current = true; setDragging(true); try { element.setPointerCapture(pointerId); } catch { finishTouchDrag(element); } }, 320); }}
    onPointerMove={(event) => { if (!draggingRef.current) return; event.preventDefault(); event.currentTarget.style.setProperty("--drag-x", `${event.clientX - origin.current.x}px`); event.currentTarget.style.setProperty("--drag-y", `${event.clientY - origin.current.y}px`); const target = document.elementsFromPoint(event.clientX, event.clientY).map((element) => element.closest<HTMLElement>("[data-book-id]")).find((element) => element?.dataset.bookId && element.dataset.bookId !== book.id); if (target?.dataset.bookId) targetId.current = target.dataset.bookId; }}
    onPointerUp={(event) => { clearTimer(); if (draggingRef.current) { event.preventDefault(); onDropBook?.(book.id, targetId.current); finishTouchDrag(event.currentTarget); setTimeout(() => { suppressClick.current = false; }, 0); } }} onPointerCancel={(event) => { clearTimer(); finishTouchDrag(event.currentTarget); }}>
    {children}</div>;
}

function CatalogSearch({ query, setQuery, searching, message, results, onSearch, onChoose }: { query: string; setQuery: (value: string) => void; searching: boolean; message: string; results: CatalogBook[]; onSearch: () => void; onChoose: (book: CatalogBook) => void }) {
  return <section className="catalog-search" aria-labelledby="catalog-title"><div><span className="eyebrow">Google Books · Open Library · ЛитРес</span><h3 id="catalog-title">Найти книгу в каталоге</h3><p>Введите название или автора. Обложка, автор и описание заполнятся автоматически — всё можно исправить.</p></div><div className="catalog-search-row"><input className="field" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }} placeholder="Например, Мастер и Маргарита" aria-label="Название или автор книги"/><button type="button" className="primary-button" onClick={onSearch} disabled={searching}>{searching ? "Ищу…" : "Найти"}</button></div>{message && <p className="catalog-message" role="status">{message}</p>}{results.length > 0 && <div className="catalog-results">{results.map((result) => <button type="button" className="catalog-result" key={result.id} onClick={() => onChoose(result)}><span className="catalog-cover">{result.cover ? <img src={result.cover} alt=""/> : <span>✦</span>}</span><span><strong>{result.title}</strong><small>{result.authors.join(", ") || "Автор не указан"}{result.year ? ` · ${result.year}` : ""}</small><em>{result.source}</em></span></button>)}</div>}</section>;
}

function ReadingPage({ books, pausedBooks, onOpen, onAdd }: { books: Book[]; pausedBooks: Book[]; onOpen: (book: Book) => void; onAdd: () => void }) {
  return <section className="page"><div className="page-heading reading-page-heading"><div><h1>Сейчас читаю</h1><span className="eyebrow">Открытые истории</span></div></div>{books.length ? <CoverShelf books={books} onOpen={onOpen}/> : <div className="empty-state"><div><div className="empty-orb">☾</div><h2>Пока здесь тихо</h2><p>Добавьте книгу со статусом «Читаю», и здесь появятся её обложка и дата начала.</p><button className="primary-button" onClick={onAdd}>Добавить книгу</button></div></div>}{pausedBooks.length > 0 && <section className="paused-reading-shelf" aria-labelledby="paused-reading-title"><div className="paused-reading-heading"><h2 id="paused-reading-title">Отложено</h2><span className="eyebrow">Эти книги ждут твоего возвращения</span></div><CoverShelf books={pausedBooks} onOpen={onOpen}/></section>}</section>;
}

function StatsPage({ books, onOpen }: { books: Book[]; onOpen: (book: Book) => void }) {
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [details, setDetails] = useState<StatsDetails | null>(null);
  const completed = useMemo(() => books.flatMap((book) => book.journal.filter((entry) => entry.finishedAt).map((entry) => ({ book, entry }))), [books]);
  const availableYears = useMemo(() => Array.from(new Set(["2025", "2026", "2027", ...completed.map(({ entry }) => entry.finishedAt.slice(0, 4)), ...books.flatMap((book) => [book.createdAt.slice(0, 4), book.readAt?.slice(0, 4) || ""])].filter((year) => /^\d{4}$/.test(year)))).sort((a, b) => Number(b) - Number(a)), [books, completed]);
  const inPeriod = (date: string) => {
    const [year, month] = date.split("-");
    return !!date && (selectedYears.length === 0 || selectedYears.includes(year)) && (selectedMonths.length === 0 || selectedMonths.includes(Number(month)));
  };
  const periodCompleted = completed.filter(({ entry }) => inPeriod(entry.finishedAt));
  const completedBooks = uniqueBooks(periodCompleted.map(({ book }) => book));
  const authors = new Set(periodCompleted.map(({ book }) => book.author.trim()).filter(Boolean)).size;
  const ratings = periodCompleted.flatMap(({ entry }) => entry.rating === undefined ? [] : [entry.rating]);
  const averageRating = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : undefined;
  const durations = periodCompleted.flatMap(({ entry }) => {
    const duration = readingDurationDays(entry.startedAt, entry.finishedAt);
    return duration === undefined ? [] : [duration];
  });
  const averageDuration = durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : undefined;
  const genreCounts = periodCompleted.reduce((counts, { book }) => {
    const genre = book.genre.trim();
    if (!genre) return counts;
    const key = genre.toLocaleLowerCase("ru");
    const current = counts.get(key);
    counts.set(key, { label: current?.label || genre, count: (current?.count || 0) + 1 });
    return counts;
  }, new Map<string, { label: string; count: number }>());
  const topGenreCount = Math.max(0, ...Array.from(genreCounts.values(), ({ count }) => count));
  const favoriteGenres = Array.from(genreCounts.values()).filter(({ count }) => count === topGenreCount).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  const highestRating = periodCompleted.reduce<number | undefined>((best, { entry }) => entry.rating === undefined ? best : Math.max(best ?? entry.rating, entry.rating), undefined);
  const bestBooks = highestRating === undefined ? [] : Array.from(new Map(periodCompleted.filter(({ entry }) => entry.rating === highestRating).map(({ book }) => [book.id, book])).values());
  const lowestRating = periodCompleted.reduce<number | undefined>((worst, { entry }) => entry.rating === undefined ? worst : Math.min(worst ?? entry.rating, entry.rating), undefined);
  const worstBooks = lowestRating === undefined ? [] : uniqueBooks(periodCompleted.filter(({ entry }) => entry.rating === lowestRating).map(({ book }) => book));
  const rereadings = books.flatMap((book) => {
    const entries = book.journal.filter((entry) => entry.finishedAt).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt) || a.createdAt.localeCompare(b.createdAt));
    return entries[1] && inPeriod(entries[1].finishedAt) ? [{ book, entry: entries[1] }] : [];
  });
  const authorGroups = periodCompleted.reduce((groups, reading) => {
    const author = reading.book.author.trim();
    if (!author) return groups;
    const key = author.toLocaleLowerCase("ru");
    const group = groups.get(key) || { label: author, readings: [] as typeof periodCompleted };
    group.readings.push(reading); groups.set(key, group); return groups;
  }, new Map<string, { label: string; readings: typeof periodCompleted }>());
  const authorStats = Array.from(authorGroups.values()).map((group) => {
    const authorRatings = group.readings.flatMap(({ entry }) => entry.rating === undefined ? [] : [entry.rating]);
    return { ...group, average: authorRatings.length ? authorRatings.reduce((sum, rating) => sum + rating, 0) / authorRatings.length : undefined };
  });
  const topAuthorReadingCount = Math.max(0, ...authorStats.map(({ readings }) => readings.length));
  const favoriteAuthorsByReadings = authorStats.filter(({ readings }) => readings.length === topAuthorReadingCount && topAuthorReadingCount > 0);
  const bestAuthorAverage = authorStats.reduce<number | undefined>((best, { average }) => average === undefined ? best : Math.max(best ?? average, average), undefined);
  const favoriteAuthorsByRating = bestAuthorAverage === undefined ? [] : authorStats.filter(({ average }) => average === bestAuthorAverage);
  const languageStats = buildCategoryStats(completedBooks, (book) => languageLabel(book.language));
  const formatStats = buildCategoryStats(completedBooks, (book) => book.formats.length ? book.formats.map(formatLabel) : ["Не указан"]);
  const formatCombinationStats = buildCategoryStats(completedBooks, (book) => book.formats.length ? [...book.formats].sort((a, b) => formatOrder.indexOf(a) - formatOrder.indexOf(b)).map(formatLabel).join(" + ") : "Не указан");
  const wantedBooks = books.filter((book) => book.status === "want" && inPeriod(book.createdAt));
  const toggleYear = (year: string) => setSelectedYears((all) => all.includes(year) ? all.filter((item) => item !== year) : [...all, year]);
  const toggleMonth = (month: number) => setSelectedMonths((all) => all.includes(month) ? all.filter((item) => item !== month) : [...all, month]);
  const periodLabel = [selectedYears.length ? `годы: ${[...selectedYears].sort().join(", ")}` : "все годы", selectedMonths.length ? `месяцы: ${[...selectedMonths].sort((a, b) => a - b).map((month) => monthNames[month - 1]).join(", ")}` : "все месяцы"].join(" · ");

  const readingItems = (readings: typeof periodCompleted, meta: (reading: typeof periodCompleted[number]) => string): StatBookItem[] => readings.map((reading) => ({ key: `${reading.book.id}-${reading.entry.id}`, book: reading.book, meta: meta(reading) }));
  const openDetails = (title: string, description: string, items: StatBookItem[]) => setDetails({ title, description, items });
  const openBook = (book: Book) => { setDetails(null); onOpen(book); };

  return <section className="page"><div className="page-heading"><div><h1>Книжные итоги</h1><p>Выберите период, чтобы увидеть завершённые чтения, оценки и книги в списке «Хочу прочитать».</p></div></div>
    <div className="stats-filters" aria-label="Фильтры книжных итогов">
      <MultiSelect label="Год" summary={selectedYears.length ? `Выбрано: ${selectedYears.length}` : "Все годы"} options={availableYears.map((year) => ({ value: year, label: year }))} selected={selectedYears} onToggle={toggleYear} emptyMessage="Пока нет дат для выбора." />
      <MultiSelect label="Месяц" summary={selectedMonths.length ? `Выбрано: ${selectedMonths.length}` : "Все месяцы"} options={monthNames.map((month, index) => ({ value: String(index + 1), label: month }))} selected={selectedMonths.map(String)} onToggle={(month) => toggleMonth(Number(month))} />
      {(selectedYears.length > 0 || selectedMonths.length > 0) && <button type="button" className="clear-filters" onClick={() => { setSelectedYears([]); setSelectedMonths([]); }}>Сбросить</button>}
    </div>
    <p className="period-caption">Период: {periodLabel}</p>
    <div className="stats-summary-grid">
      <StatSummary title="Прочитано" value={periodCompleted.length} caption="завершённых чтений за выбранный период." onClick={() => openDetails("Прочитано", "Все завершённые чтения за выбранный период.", readingItems(periodCompleted, ({ entry }) => `Завершено: ${formatShortDate(entry.finishedAt)}`))} />
      <StatSummary title="Авторы" value={authors} caption="у завершённых чтений за выбранный период." onClick={() => openDetails("Авторы", "Книги всех авторов, учтённых в показателе.", bookItems(completedBooks.filter((book) => book.author.trim()), (book) => book.author))} />
      <StatSummary title="Средняя оценка" value={averageRating === undefined ? "—" : formatStatNumber(averageRating)} caption={ratings.length ? `из 10 · оценено записей: ${ratings.length}` : "Нет оценённых записей за этот период."} onClick={() => openDetails("Средняя оценка", "Чтения с оценкой, вошедшие в расчёт среднего.", readingItems(periodCompleted.filter(({ entry }) => entry.rating !== undefined), ({ entry }) => `${entry.rating} из 10 · ${formatShortDate(entry.finishedAt)}`))} />
      <StatSummary title="Время чтения" value={averageDuration === undefined ? "—" : formatStatNumber(averageDuration)} caption={durations.length ? `дн. в среднем · записей с датами: ${durations.length}` : "Укажите даты начала и окончания чтения."} onClick={() => openDetails("Время чтения", "Чтения с заполненными корректными датами, вошедшие в расчёт среднего.", readingItems(periodCompleted.filter(({ entry }) => readingDurationDays(entry.startedAt, entry.finishedAt) !== undefined), ({ entry }) => `${readingDurationDays(entry.startedAt, entry.finishedAt)} дн. · ${formatDateRange(entry.startedAt, entry.finishedAt)}`))} />
    </div>
    <div className="stats-grid">
      <article className="panel favorite-genres"><h2>Любимые жанры</h2>{favoriteGenres.length ? <><div className="genre-list">{favoriteGenres.map(({ label }) => <span className="tag" key={label}>{label}</span>)}</div><button type="button" className="inline-stat-button" onClick={() => openDetails("Любимые жанры", "Завершённые чтения самых частых жанров.", readingItems(periodCompleted.filter(({ book }) => favoriteGenres.some(({ label }) => label.toLocaleLowerCase("ru") === book.genre.trim().toLocaleLowerCase("ru"))), ({ book, entry }) => `${book.genre} · ${formatShortDate(entry.finishedAt)}`))}>Чтений с этим жанром: {topGenreCount} →</button></> : <p className="empty-mini">У завершённых чтений пока не указаны жанры.</p>}</article>
      <article className="panel best-books"><h2>Лучшая книга</h2>{bestBooks.length ? <><p className="best-rating">{highestRating} / 10 ✦</p><BookTitleList books={bestBooks} onOpen={onOpen} /></> : <p className="empty-mini">Добавьте оценку в читательский дневник — здесь появятся книги с высшей оценкой.</p>}</article>
      <article className="panel best-books"><h2>Худшая книга</h2>{worstBooks.length ? <><p className="worst-rating">{lowestRating} / 10</p><BookTitleList books={worstBooks} onOpen={onOpen} /></> : <p className="empty-mini">Добавьте оценку в читательский дневник — здесь появятся книги с самой низкой оценкой.</p>}</article>
      <article className="panel stat-detail-panel"><h2>Перечитывания</h2><button type="button" className="large-inline-stat" onClick={() => openDetails("Перечитывания", "Книги, у которых второе завершённое чтение пришлось на выбранный период.", readingItems(rereadings, ({ entry }) => `Второе чтение завершено: ${formatShortDate(entry.finishedAt)}`))}><strong>{rereadings.length}</strong><span>{bookWord(rereadings.length)} со второй записью →</span></button></article>
      <article className="panel stat-detail-panel"><h2>Любимый автор</h2>{favoriteAuthorsByReadings.length ? <button type="button" className="metric-row" onClick={() => openDetails("Любимый автор по числу чтений", "Все завершённые чтения авторов-лидеров за выбранный период.", readingItems(favoriteAuthorsByReadings.flatMap(({ readings }) => readings), ({ entry }) => `Завершено: ${formatShortDate(entry.finishedAt)}`))}><span><small>По числу чтений</small><b>{favoriteAuthorsByReadings.map(({ label }) => label).join(", ")}</b></span><strong>{topAuthorReadingCount}</strong></button> : <p className="empty-mini">Нет завершённых чтений с указанным автором.</p>}{favoriteAuthorsByRating.length ? <button type="button" className="metric-row" onClick={() => openDetails("Любимый автор по средней оценке", "Оценённые чтения авторов с наивысшей средней оценкой.", readingItems(favoriteAuthorsByRating.flatMap(({ readings }) => readings.filter(({ entry }) => entry.rating !== undefined)), ({ entry }) => `${entry.rating} из 10 · ${formatShortDate(entry.finishedAt)}`))}><span><small>По средней оценке</small><b>{favoriteAuthorsByRating.map(({ label }) => label).join(", ")}</b></span><strong>{formatStatNumber(bestAuthorAverage!)}</strong></button> : <p className="empty-mini">Нет оценок для расчёта любимого автора.</p>}</article>
      <CategoryStats title="Языки чтения" stats={languageStats} total={completedBooks.length} onOpen={(stat) => openDetails(`Язык: ${stat.label}`, "Завершённые книги на этом языке за выбранный период.", bookItems(stat.books))} />
      <CategoryStats title="Форматы" stats={formatStats} total={completedBooks.length} onOpen={(stat) => openDetails(`Формат: ${stat.label}`, "Завершённые книги в этом формате за выбранный период.", bookItems(stat.books))} />
      <CategoryStats title="Сочетания форматов" stats={formatCombinationStats} total={completedBooks.length} onOpen={(stat) => openDetails(`Форматы: ${stat.label}`, "Завершённые книги с этим сочетанием форматов.", bookItems(stat.books))} />
      <article className="panel wanted-books"><h2>Хочу прочитать</h2><p className="empty-mini">Добавленные в выбранный период.</p>{wantedBooks.length ? <BookTitleList books={wantedBooks} onOpen={onOpen} /> : <p className="empty-mini">Таких книг пока нет.</p>}</article>
    </div>
    {details && <StatsDetailsModal details={details} onClose={() => setDetails(null)} onOpen={openBook} />}
  </section>;
}

type StatBookItem = { key: string; book: Book; meta?: string };
type StatsDetails = { title: string; description: string; items: StatBookItem[] };
type CategoryStat = { label: string; books: Book[] };

function StatSummary({ title, value, caption, onClick }: { title: string; value: string | number; caption: string; onClick: () => void }) {
  return <button type="button" className="panel summary-panel statistic-button" onClick={onClick} aria-label={`${title}: ${value}. Открыть список книг`}><h2>{title}</h2><strong className="summary-number">{value}</strong><span className="empty-mini">{caption}</span><span className="statistic-hint">Открыть список →</span></button>;
}

function CategoryStats({ title, stats, total, onOpen }: { title: string; stats: CategoryStat[]; total: number; onOpen: (stat: CategoryStat) => void }) {
  return <article className="panel stat-detail-panel"><h2>{title}</h2>{stats.length ? <div className="metric-list">{stats.map((stat) => <button type="button" className="metric-row" key={stat.label} onClick={() => onOpen(stat)}><span><b>{stat.label}</b><small>{total ? formatStatNumber(stat.books.length / total * 100) : 0}%</small></span><strong>{stat.books.length}</strong></button>)}</div> : <p className="empty-mini">За выбранный период нет завершённых книг.</p>}</article>;
}

function StatsDetailsModal({ details, onClose, onOpen }: { details: StatsDetails; onClose: () => void; onOpen: (book: Book) => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal stats-details-modal" role="dialog" aria-modal="true" aria-labelledby="stats-details-title"><header className="modal-header"><div><span className="eyebrow">Книжные итоги</span><h2 id="stats-details-title">{details.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header><div className="modal-body"><p className="stats-details-description">{details.description}</p>{details.items.length ? <ul className="stats-book-list">{details.items.map((item) => <li key={item.key}><button type="button" onClick={() => onOpen(item.book)}><span className="stats-book-cover" style={{ "--cover-color": item.book.color } as React.CSSProperties}>{item.book.cover ? <img src={item.book.cover} alt="" /> : <span>✦</span>}</span><span className="stats-book-copy"><strong>{item.book.title}</strong><span>{item.book.author || "Автор не указан"}</span>{item.meta && <small>{item.meta}</small>}</span><span className="stats-book-arrow" aria-hidden="true">›</span></button></li>)}</ul> : <p className="empty-mini">За выбранный период подходящих книг нет.</p>}</div></section></div>;
}

function uniqueBooks(books: Book[]) { return Array.from(new Map(books.map((book) => [book.id, book])).values()); }
function bookItems(books: Book[], meta?: (book: Book) => string): StatBookItem[] { return uniqueBooks(books).map((book) => ({ key: book.id, book, meta: meta?.(book) })); }
function buildCategoryStats(books: Book[], category: (book: Book) => string | string[]): CategoryStat[] {
  const groups = new Map<string, Book[]>();
  books.forEach((book) => {
    const labels = category(book); (Array.isArray(labels) ? labels : [labels]).forEach((label) => groups.set(label, [...(groups.get(label) || []), book]));
  });
  return Array.from(groups, ([label, groupedBooks]) => ({ label, books: uniqueBooks(groupedBooks) })).sort((a, b) => b.books.length - a.books.length || a.label.localeCompare(b.label, "ru"));
}
function languageLabel(language?: Language) { return languages.find(([value]) => value === language)?.[1] || "Не указан"; }
const formatOrder: Format[] = ["paper", "ebook", "audio"];
function formatLabel(format: Format) { return ({ paper: "Бумажная", ebook: "Электронная", audio: "Аудиокнига" } as const)[format]; }
function formatShortDate(date: string) { return date ? new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)) : "дата не указана"; }

const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function readingDurationDays(start: string, finish: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(finish)) return undefined;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const finishTime = Date.parse(`${finish}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(finishTime) || finishTime < startTime) return undefined;
  return Math.floor((finishTime - startTime) / 86_400_000) + 1;
}

function formatStatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function MultiSelect({ label, summary, options, selected, onToggle, emptyMessage }: { label: string; summary: string; options: Array<{ value: string; label: string }>; selected: string[]; onToggle: (value: string) => void; emptyMessage?: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);
  return <details className="multi-select" ref={detailsRef}><summary><span>{label}</span><b>{summary}</b><span aria-hidden="true">⌄</span></summary><div className="multi-select-options">{options.length ? options.map((option) => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />{option.label}</label>) : <p>{emptyMessage}</p>}</div></details>;
}

function BookTitleList({ books, onOpen }: { books: Book[]; onOpen: (book: Book) => void }) {
  return <ul className="book-title-list">{books.map((book) => <li key={book.id}><button type="button" onClick={() => onOpen(book)} aria-label={`Открыть книгу «${book.title}»`}><strong>{book.title}</strong>{book.author && <span>{book.author}</span>}</button></li>)}</ul>;
}

/* Kept temporarily as a migration reference while the searchable form below replaces it.
function LegacyBookFormModal({ book, onClose, onSave }: { book?: Book; onClose: () => void; onSave: (book: Book) => void }) {
  const [title, setTitle] = useState(book?.title || ""); const [author, setAuthor] = useState(book?.author || ""); const [description, setDescription] = useState(book?.description || "");
  const [genre, setGenre] = useState(book?.genre || ""); const [year, setYear] = useState(book?.year || ""); const [status, setStatus] = useState<Status>(book?.status || "want");
  const [formats, setFormats] = useState<Format[]>(book?.formats || []); const [cover, setCover] = useState<string | undefined>(book?.cover); const [startedAt, setStartedAt] = useState(book?.startedAt || "");
  const [kind, setKind] = useState<BookKind>(book?.kind || "fiction");
  const [catalogQuery, setCatalogQuery] = useState(""); const [catalogResults, setCatalogResults] = useState<CatalogBook[]>([]); const [searching, setSearching] = useState(false); const [catalogMessage, setCatalogMessage] = useState("");
  const toggleFormat = (format: Format) => setFormats((all) => all.includes(format) ? all.filter((item) => item !== format) : [...all, format]);
  const readCover = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 3_000_000) { alert("Выберите изображение до 3 МБ."); return; } const reader = new FileReader(); reader.onload = () => setCover(String(reader.result)); reader.readAsDataURL(file); };
  const searchCatalog = async () => { const query = catalogQuery.trim(); if (query.length < 2) { setCatalogMessage("Введите хотя бы 2 символа."); return; } setSearching(true); setCatalogMessage(""); try { const response = await fetch(`/api/books/search?q=${encodeURIComponent(query)}`); const data = await response.json() as { results?: CatalogBook[]; error?: string }; const results = data.results || []; setCatalogResults(results); setCatalogMessage(results.length ? "Выберите подходящее издание — данные можно исправить перед сохранением." : (data.error || "Ничего не найдено. Добавьте книгу вручную ниже.")); } catch { setCatalogResults([]); setCatalogMessage("Не удалось связаться с каталогом. Добавьте книгу вручную ниже."); } finally { setSearching(false); } };
  const chooseCatalogBook = (result: CatalogBook) => { setTitle(result.title); setAuthor(result.authors.join(", ")); setDescription(result.description); setGenre(result.genres[0] || ""); setYear(result.year || ""); setCover(result.cover); setCatalogResults([]); setCatalogMessage(`Выбрано из каталога ${result.source}. Проверьте данные и сохраните книгу.`); };
  void [setCatalogQuery, catalogResults, searching, catalogMessage, searchCatalog, chooseCatalogBook];
  const submit = (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; const now = new Date().toISOString(); onSave({ id: book?.id || crypto.randomUUID(), title: title.trim(), author: author.trim(), description: description.trim(), genre: genre.trim(), year: year.trim(), status, formats, cover, color: book?.color || colors[Math.floor(Math.random() * colors.length)], createdAt: book?.createdAt || now, updatedAt: now, startedAt: status === "reading" ? (startedAt || new Date().toISOString().slice(0,10)) : book?.startedAt, kind, journal: book?.journal || [] }); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><header className="modal-header"><h2 id="edit-title">{book ? "Редактировать книгу" : "Новая книга"}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header><form className="modal-body" onSubmit={submit}><div className="upload"><div className="upload-preview">{cover ? <img src={cover} alt="Предпросмотр обложки"/> : "Своя обложка"}</div><div><p className="legend">Загрузите или замените обложку с устройства.</p><input type="file" accept="image/png,image/jpeg,image/webp" onChange={readCover} aria-label="Загрузить обложку" />{cover && <button type="button" className="text-button" onClick={() => setCover(undefined)}>Убрать обложку</button>}</div></div><div className="form-grid" style={{marginTop:"1rem"}}><div className="form-group full"><label htmlFor="title">Название *</label><input id="title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} required /></div><div className="form-group"><label htmlFor="author">Автор</label><input id="author" className="field" value={author} onChange={(e) => setAuthor(e.target.value)} /></div><div className="form-group"><label htmlFor="year">Год</label><input id="year" className="field" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></div><div className="form-group"><label htmlFor="genre">Жанр</label><input id="genre" className="field" value={genre} onChange={(e) => setGenre(e.target.value)} /></div><div className="form-group"><label htmlFor="kind">Тип книги</label><select id="kind" value={kind} onChange={(e) => setKind(e.target.value as BookKind)}><option value="fiction">Художественная</option><option value="nonfiction">Нон-фикшен</option></select></div><div className="form-group"><label htmlFor="status">Статус</label><select id="status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{statuses.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>{status === "reading" && <div className="form-group"><label htmlFor="started">Дата начала</label><input id="started" className="field" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></div>}<div className="form-group full"><span className="legend">Форматы — можно выбрать несколько</span><div className="check-row">{([["paper","Бумажная"],["ebook","Электронная"],["audio","Аудиокнига"]] as Array<[Format,string]>).map(([value,label]) => <label className="check-chip" key={value}><input type="checkbox" checked={formats.includes(value)} onChange={() => toggleFormat(value)}/>{label}</label>)}</div></div><div className="form-group full"><label htmlFor="description">Описание</label><textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Можно заполнить сейчас или вернуться позже" /></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{book ? "Сохранить изменения" : "Поставить на полку"}</button></div></form></section></div>;
} */

function BookFormModal({ book, onClose, onSave }: { book?: Book; onClose: () => void; onSave: (book: Book) => void }) {
  const [title, setTitle] = useState(book?.title || "");
  const [author, setAuthor] = useState(book?.author || "");
  const [description, setDescription] = useState(book?.description || "");
  const [genre, setGenre] = useState(book?.genre || "");
  const [year, setYear] = useState(book?.year || "");
  const [status, setStatus] = useState<Status>(book?.status || "want");
  const [formats, setFormats] = useState<Format[]>(book?.formats || []);
  const [cover, setCover] = useState<string | undefined>(book?.cover);
  const [startedAt, setStartedAt] = useState(book?.startedAt || "");
  const [kind, setKind] = useState<BookKind>(book?.kind || "fiction");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [catalogSource, setCatalogSource] = useState(book?.catalogSource);
  const [catalogExternalId, setCatalogExternalId] = useState(book?.catalogExternalId);

  const searchCatalog = async () => {
    const query = catalogQuery.trim();
    if (query.length < 2) { setCatalogMessage("Введите хотя бы 2 символа."); return; }
    setSearching(true); setCatalogMessage("");
    try {
      const response = await fetch(`/api/books/search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000) });
      const data = await response.json() as { results?: CatalogBook[]; error?: string };
      const results = data.results || [];
      setCatalogResults(results);
      setCatalogMessage(results.length ? "Выберите подходящее издание — данные можно исправить перед сохранением." : (data.error || "Ничего не найдено. Добавьте книгу вручную ниже."));
    } catch { setCatalogResults([]); setCatalogMessage("Не удалось связаться с каталогом. Добавьте книгу вручную ниже."); }
    finally { setSearching(false); }
  };
  const chooseCatalogBook = (result: CatalogBook) => {
    setTitle(result.title); setAuthor(result.authors.join(", ")); setDescription(result.description);
    setGenre(result.genres[0] || ""); setYear(result.year || ""); setCover(result.cover);
    setCatalogSource(result.catalogSource || result.source); setCatalogExternalId(result.catalogExternalId || result.id);
    setCatalogResults([]); setCatalogMessage(`Выбрано из каталога ${result.source}. Проверьте данные и сохраните книгу.`);
  };
  const readCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 3_000_000) { alert("Выберите изображение до 3 МБ."); return; }
    const reader = new FileReader(); reader.onload = () => setCover(String(reader.result)); reader.readAsDataURL(file);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return;
    const now = new Date().toISOString(); onSave({ id: book?.id || crypto.randomUUID(), title: title.trim(), author: author.trim(), description: description.trim(), genre: genre.trim(), year: year.trim(), status, formats, cover, color: book?.color || colors[Math.floor(Math.random() * colors.length)], createdAt: book?.createdAt || now, updatedAt: now, startedAt: status === "reading" ? (startedAt || new Date().toISOString().slice(0,10)) : book?.startedAt, kind, journal: book?.journal || [], catalogSource, catalogExternalId });
  };
  const toggleFormat = (format: Format) => setFormats((all) => all.includes(format) ? all.filter((item) => item !== format) : [...all, format]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><header className="modal-header"><h2 id="edit-title">{book ? "Редактировать книгу" : "Новая книга"}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header><form className="modal-body" onSubmit={submit}>
    {!book && <CatalogSearch query={catalogQuery} setQuery={setCatalogQuery} searching={searching} message={catalogMessage} results={catalogResults} onSearch={searchCatalog} onChoose={chooseCatalogBook}/>}
    <div className="upload"><div className="upload-preview">{cover ? <img src={cover} alt="Предпросмотр обложки"/> : "Своя обложка"}</div><div><p className="legend upload-instruction">Загрузите обложку с устройства</p><div className="upload-actions"><label className="upload-action"><input className="cover-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={readCover}/><span>Выбрать файл</span></label>{cover && <button type="button" className="upload-action" onClick={() => setCover(undefined)}>Удалить обложку</button>}</div></div></div>
    <div className="form-grid book-fields"><div className="form-group full"><label htmlFor="title">Название *</label><input id="title" className="field" value={title} onChange={(event) => setTitle(event.target.value)} required/></div><div className="form-group"><label htmlFor="author">Автор</label><input id="author" className="field" value={author} onChange={(event) => setAuthor(event.target.value)}/></div><div className="form-group"><label htmlFor="year">Год</label><input id="year" className="field" inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)}/></div><div className="form-group"><label htmlFor="genre">Жанр</label><input id="genre" className="field" value={genre} onChange={(event) => setGenre(event.target.value)}/></div><div className="form-group"><label htmlFor="kind">Тип книги</label><select id="kind" value={kind} onChange={(event) => setKind(event.target.value as BookKind)}><option value="fiction">Художественная</option><option value="nonfiction">Нон-фикшен</option></select></div>{!book && <><div className="form-group"><label htmlFor="status">Статус</label><select id="status" value={status} onChange={(event) => setStatus(event.target.value as Status)}>{statuses.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>{status === "reading" && <div className="form-group"><label htmlFor="started">Дата начала</label><input id="started" className="field" type="date" value={startedAt} onChange={(event) => setStartedAt(event.target.value)}/></div>}<div className="form-group full"><span className="legend">Форматы — можно выбрать несколько</span><div className="check-row">{([["paper","Бумажная"],["ebook","Электронная"],["audio","Аудиокнига"]] as Array<[Format,string]>).map(([value,label]) => <label className="check-chip" key={value}><input type="checkbox" checked={formats.includes(value)} onChange={() => toggleFormat(value)}/>{label}</label>)}</div></div></>}<div className="form-group full"><label htmlFor="description">Описание</label><textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Можно заполнить сейчас или вернуться позже"/></div></div>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{book ? "Сохранить изменения" : "Поставить на полку"}</button></div>
  </form></section></div>;
}

const fictionQuestions = ["Какое впечатление осталось сразу после чтения?", "Что понравилось больше всего?", "Что не понравилось или показалось слабым?", "Какие персонажи запомнились и почему?", "Какая сцена запомнилась сильнее всего?", "Какие мысли вызвала книга?", "Какое настроение и атмосферу она создавала?"];
const nonfictionQuestions = ["Что нового я узнала?", "С чем я согласна или не согласна?", "Какая идея оказалась самой ценной?", "Что я хочу запомнить или применить?"];

function BookModal({ book, onClose, onDelete, onSave }: { book: Book; onClose: () => void; onDelete: () => void; onSave: (book: Book) => void }) {
  const [editing, setEditing] = useState(false); const [diaryOpen, setDiaryOpen] = useState(false); const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const editingEntry = book.journal.find((entry) => entry.id === editingEntryId);
  const changeStatus = (status: Status) => onSave({ ...book, status, startedAt: status === "reading" ? (book.startedAt || new Date().toISOString().slice(0, 10)) : book.startedAt });
  const changeLanguage = (language: Language | "") => onSave({ ...book, language: language || undefined });
  const toggleFormat = (format: Format) => onSave({ ...book, formats: book.formats.includes(format) ? book.formats.filter((item) => item !== format) : [...book.formats, format] });
  if (editing) return <BookFormModal book={book} onClose={() => setEditing(false)} onSave={(next) => { onSave(next); setEditing(false); }} />;
  if (editingEntry) return <JournalModal book={book} entry={editingEntry} onClose={() => setEditingEntryId(null)} onSave={(updatedEntry) => { onSave({ ...book, journal: book.journal.map((entry) => entry.id === updatedEntry.id ? updatedEntry : entry), status: updatedEntry.finishedAt ? "read" : book.status }); setEditingEntryId(null); }} />;
  if (diaryOpen) return <JournalModal book={book} onClose={() => setDiaryOpen(false)} onSave={(entry) => { onSave({...book, journal: [entry, ...book.journal], status: entry.finishedAt ? "read" : book.status}); setDiaryOpen(false); }} />;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="book-title">
      <header className="modal-header"><h2>Книга на полке</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header>
      <div className="modal-body">
        <div className="book-detail">
          <div className="detail-cover" style={{ "--cover-color": book.color } as React.CSSProperties}>{book.cover ? <img src={book.cover} alt={`Обложка книги «${book.title}»`}/> : <span className="detail-cover-title">{book.title}</span>}</div>
          <div className="detail-copy"><h3 id="book-title">{book.title}</h3><p className="author">{book.author || "Автор не указан"}{book.year ? ` · ${book.year}` : ""}</p><div className="tags"><span className="tag">{book.kind === "fiction" ? "Художественная" : "Нон-фикшен"}</span>{book.genre && <span className="tag">{book.genre}</span>}</div><p className="description">{book.description || "Описание пока не добавлено."}</p><div className="detail-actions"><button className="secondary-button" onClick={() => setEditing(true)}>✎ Редактировать книгу</button><button className="primary-button" onClick={() => setDiaryOpen(true)}>✦ Новая запись дневника</button></div></div>
        </div>
        <section className="reading-controls" aria-labelledby="reading-controls-title">
          <h3 id="reading-controls-title">Чтение</h3>
          <div className="reading-controls-grid">
            <div className="form-group"><label htmlFor="book-reading-status">Статус</label><select id="book-reading-status" value={book.status} onChange={(event) => changeStatus(event.target.value as Status)}>{statuses.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="form-group"><label htmlFor="book-reading-language">Язык</label><select id="book-reading-language" value={book.language || ""} onChange={(event) => changeLanguage(event.target.value as Language | "")}><option value="">Не выбран</option>{languages.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <fieldset className="reading-formats"><legend>Форматы</legend><div className="check-row">{([["paper","Бумажная"],["ebook","Электронная"],["audio","Аудиокнига"]] as Array<[Format,string]>).map(([value,label]) => <label className="check-chip" key={value}><input type="checkbox" checked={book.formats.includes(value)} onChange={() => toggleFormat(value)}/>{label}</label>)}</div></fieldset>
          </div>
        </section>
        <section className="journal-history"><div className="section-heading"><h3>Читательский дневник</h3><span>{book.journal.length ? `${book.journal.length} ${book.journal.length === 1 ? "запись" : "записи"}` : "Пока без записей"}</span></div>{book.journal.length ? book.journal.map((entry, index) => <JournalCard key={entry.id} entry={entry} index={book.journal.length - index} canEdit={index === 0} onEdit={() => setEditingEntryId(entry.id)} />) : <p className="empty-mini">Ответьте только на те вопросы, которые помогут сохранить впечатление. Все поля необязательны.</p>}</section>
        <div className="modal-actions book-modal-actions"><button className="secondary-button danger" onClick={onDelete}>Удалить книгу</button><button className="secondary-button" onClick={onClose}>Закрыть</button></div>
      </div>
    </section>
  </div>;
}

function JournalModal({ book, entry, onClose, onSave }: { book: Book; entry?: JournalEntry; onClose: () => void; onSave: (entry: JournalEntry) => void }) {
  const questions = book.kind === "nonfiction" ? nonfictionQuestions : fictionQuestions;
  const [startedAt, setStartedAt] = useState(entry?.startedAt || book.startedAt || ""); const [finishedAt, setFinishedAt] = useState(entry?.finishedAt || new Date().toISOString().slice(0, 10)); const [rating, setRating] = useState<number | undefined>(entry?.rating); const [answers, setAnswers] = useState<Record<string,string>>(entry?.answers || {}); const [comment, setComment] = useState(entry?.comment || "");
  const submit = (event: FormEvent) => { event.preventDefault(); onSave({ id: entry?.id || crypto.randomUUID(), startedAt, finishedAt, rating, answers, comment, createdAt: entry?.createdAt || new Date().toISOString() }); };
  return <div className="modal-backdrop"><section className="modal diary-modal" role="dialog" aria-modal="true" aria-labelledby="diary-title"><header className="modal-header"><div><span className="eyebrow">{book.title}</span><h2 id="diary-title">{entry ? "Редактировать запись дневника" : "Новая запись дневника"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header><form className="modal-body" onSubmit={submit}><div className="date-row"><div className="form-group"><label htmlFor="journal-start">Начала читать</label><input className="field" id="journal-start" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></div><div className="form-group"><label htmlFor="journal-finish">Закончила</label><input className="field" id="journal-finish" type="date" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} /></div></div><fieldset className="rating"><legend>Моя оценка</legend><div className="stars" role="radiogroup" aria-label="Оценка от 1 до 10">{Array.from({length:10},(_,i)=>i+1).map((star)=><button key={star} type="button" role="radio" aria-checked={rating === star} aria-label={`${star} из 10`} className={rating && star <= rating ? "filled" : ""} onClick={() => setRating(star)}>✦</button>)}</div>{rating && <span className="rating-value">{rating} / 10</span>}</fieldset><div className="journal-questions">{questions.map((question, index) => <div className="form-group" key={question}><label htmlFor={`question-${index}`}>{question}</label><textarea id={`question-${index}`} value={answers[question] || ""} onChange={(e) => setAnswers({...answers,[question]:e.target.value})} /></div>)}</div><div className="form-group"><label htmlFor="free-comment">Свободный комментарий</label><textarea id="free-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Любые мысли, для которых не подошёл вопрос…" /></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit">Сохранить запись</button></div></form></section></div>;
}
function JournalCard({ entry, index, canEdit = false, onEdit }: { entry: JournalEntry; index: number; canEdit?: boolean; onEdit?: () => void }) {
  const nonEmpty = Object.entries(entry.answers).filter(([,answer]) => answer.trim());
  return <details className="journal-card"><summary><span><b>Чтение № {index}</b><small>{formatDateRange(entry.startedAt, entry.finishedAt)}</small></span>{entry.rating && <span className="journal-rating">{entry.rating} ✦</span>}</summary><div className="journal-card-body">{nonEmpty.map(([question,answer]) => <div key={question}><h4>{question}</h4><p>{answer}</p></div>)}{entry.comment && <div><h4>Свободный комментарий</h4><p>{entry.comment}</p></div>}{!nonEmpty.length && !entry.comment && <p className="empty-mini">Запись сохранена без текста.</p>}{canEdit && <div className="journal-card-actions"><button type="button" className="secondary-button" onClick={onEdit}>✎ Редактировать запись</button></div>}</div></details>;
}

function formatDateRange(start: string, finish: string) { const nice = (value: string) => value ? new Intl.DateTimeFormat("ru", {day:"numeric",month:"short",year:"numeric"}).format(new Date(`${value}T12:00:00`)) : "дата не указана"; return `${nice(start)} — ${nice(finish)}`; }

function bookWord(count: number) { const mod10 = count % 10, mod100 = count % 100; if (mod10 === 1 && mod100 !== 11) return "книга"; if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "книги"; return "книг"; }
