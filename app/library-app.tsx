"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type View = "home" | "library" | "reading" | "stats";
type ShelfView = "spines" | "covers";
type Status = "want" | "reading" | "read" | "paused" | "abandoned";
type Format = "paper" | "ebook" | "audio";

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
  startedAt?: string;
};

const STORAGE_KEY = "enchanted-library-v1";
const statuses: Array<[Status, string]> = [
  ["want", "Хочу прочитать"], ["reading", "Читаю"], ["read", "Прочитано"],
  ["paused", "Отложено"], ["abandoned", "Брошено"],
];
const colors = ["#385b73", "#704d68", "#586c50", "#77584b", "#4c4c78", "#795a30"];

function loadBooks(): Book[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as Book[]; } catch { return []; }
}

export function LibraryApp() {
  const [view, setView] = useState<View>("home");
  const [books, setBooks] = useState<Book[]>(loadBooks);
  const [shelfView, setShelfView] = useState<ShelfView>("spines");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [sort, setSort] = useState<"manual" | "title" | "author" | "year">("manual");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Book | null>(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(books)); }, [books]);

  const shownBooks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const next = books.filter((book) => (status === "all" || book.status === status) &&
      (!needle || `${book.title} ${book.author} ${book.genre}`.toLocaleLowerCase("ru").includes(needle)));
    if (sort === "manual") return next;
    return [...next].sort((a, b) => (a[sort] || "").localeCompare(b[sort] || "", "ru", { numeric: true }));
  }, [books, query, status, sort]);

  const reading = books.filter((book) => book.status === "reading");
  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const addBook = (book: Book) => { setBooks((current) => [book, ...current]); setAdding(false); setView("library"); };
  const deleteBook = (id: string) => { if (confirm("Удалить книгу из библиотеки?")) { setBooks((all) => all.filter((book) => book.id !== id)); setSelected(null); } };

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
      <button className="primary-button" onClick={() => setAdding(true)}>＋ Добавить книгу</button>
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
      {!shownBooks.length ? <EmptyLibrary hasBooks={!!books.length} onAdd={() => setAdding(true)} /> : shelfView === "spines" ? <SpineShelf books={shownBooks} onOpen={setSelected} /> : <CoverShelf books={shownBooks} onOpen={setSelected} />}
    </section>}
    {view === "reading" && <ReadingPage books={reading} onOpen={setSelected} onAdd={() => setAdding(true)} />}
    {view === "stats" && <StatsPage books={books} />}

    <nav className="bottom-nav" aria-label="Мобильная навигация">
      <NavButton active={view === "home"} onClick={() => navigate("home")}>⌂<br/>Главная</NavButton>
      <NavButton active={view === "library"} onClick={() => navigate("library")}>▥<br/>Полки</NavButton>
      <NavButton active={view === "reading"} onClick={() => navigate("reading")}>◫<br/>Читаю</NavButton>
      <NavButton active={view === "stats"} onClick={() => navigate("stats")}>✧<br/>Итоги</NavButton>
    </nav>
    {adding && <AddBookModal onClose={() => setAdding(false)} onSave={addBook} />}
    {selected && <BookModal book={selected} onClose={() => setSelected(null)} onDelete={() => deleteBook(selected.id)} />}
  </main>;
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function Home({ books, onLibrary, onAdd }: { books: Book[]; onLibrary: () => void; onAdd: () => void }) {
  const reading = books.filter((book) => book.status === "reading").length;
  return <section className="page">
    <div className="hero">
      <div className="sparkles" aria-hidden="true"><span/><span/><span/><span/></div>
      <div className="hero-copy"><span className="eyebrow">Личный читательский дневник</span><h1>Ваша история чтения</h1><p className="hero-description">Собирайте книги на волшебных полках, сохраняйте впечатления и возвращайтесь к ним спустя годы.</p><div className="hero-actions"><button className="primary-button" onClick={onLibrary}>Открыть библиотеку</button><button className="secondary-button" onClick={onAdd}>Добавить первую книгу</button></div><p className="hero-note">Все записи остаются только на этом устройстве.</p></div>
    </div>
    <div className="welcome-grid"><article className="panel"><h2>Сейчас читаю</h2><p className="empty-mini">{reading ? `${reading} ${bookWord(reading)} ждут продолжения.` : "Когда начнёте книгу, она появится здесь — с обложкой и датой начала."}</p></article><article className="panel"><h2>Тихие итоги</h2><div className="stat-row"><div className="stat"><strong>{books.length}</strong><span>в библиотеке</span></div><div className="stat"><strong>{books.filter((b) => b.status === "read").length}</strong><span>прочитано</span></div></div></article></div>
  </section>;
}

function EmptyLibrary({ hasBooks, onAdd }: { hasBooks: boolean; onAdd: () => void }) {
  return <div className="empty-state"><div><div className="empty-orb">✦</div><h2>{hasBooks ? "Ничего не найдено" : "Полки ждут первую книгу"}</h2><p>{hasBooks ? "Попробуйте изменить поиск или фильтр." : "Найдённые в каталогах книги и редкие издания, добавленные вручную, будут жить рядом."}</p>{!hasBooks && <button className="primary-button" onClick={onAdd}>＋ Добавить книгу</button>}</div></div>;
}

function SpineShelf({ books, onOpen }: { books: Book[]; onOpen: (book: Book) => void }) {
  return <div className="shelves"><div className="shelf">{books.map((book, index) => <button key={book.id} className="spine" style={{ "--spine-color": book.color, "--spine-width": `${50 + (index % 4) * 7}px`, "--spine-height": `${160 + (index % 5) * 13}px` } as React.CSSProperties} onClick={() => onOpen(book)} aria-label={`Открыть книгу «${book.title}»`}>{book.title}</button>)}</div></div>;
}

function CoverShelf({ books, onOpen }: { books: Book[]; onOpen: (book: Book) => void }) {
  return <div className="cover-grid">{books.map((book) => <button key={book.id} className="cover-card" onClick={() => onOpen(book)}><div className="cover-art" style={{ "--cover-color": book.color } as React.CSSProperties}>{book.cover ? <img src={book.cover} alt="" /> : <span className="cover-placeholder">✦<br/>{book.title}</span>}</div><strong>{book.title}</strong><small>{book.author || "Автор не указан"}</small></button>)}</div>;
}

function ReadingPage({ books, onOpen, onAdd }: { books: Book[]; onOpen: (book: Book) => void; onAdd: () => void }) {
  return <section className="page"><div className="page-heading"><div><span className="eyebrow">Открытые истории</span><h1>Сейчас читаю</h1><p>Несколько книг могут идти рядом — без процентов и обязательного темпа.</p></div></div>{books.length ? <CoverShelf books={books} onOpen={onOpen}/> : <div className="empty-state"><div><div className="empty-orb">☾</div><h2>Пока здесь тихо</h2><p>Добавьте книгу со статусом «Читаю», и здесь появятся её обложка и дата начала.</p><button className="primary-button" onClick={onAdd}>Добавить книгу</button></div></div>}</section>;
}

function StatsPage({ books }: { books: Book[] }) {
  const read = books.filter((book) => book.status === "read");
  const authors = new Set(read.map((book) => book.author).filter(Boolean)).size;
  return <section className="page"><div className="page-heading"><div><span className="eyebrow">Без гонки и целей</span><h1>Тихие итоги</h1><p>Статистика будет расти вместе с вашей историей чтения.</p></div></div><div className="welcome-grid"><article className="panel"><h2>Вся история</h2><div className="stat-row"><div className="stat"><strong>{read.length}</strong><span>прочитано</span></div><div className="stat"><strong>{authors}</strong><span>авторов</span></div></div></article><article className="panel"><h2>Скоро здесь</h2><p className="empty-mini">Книги по месяцам, любимые жанры, средняя оценка и время чтения — после появления записей дневника.</p></article></div></section>;
}

function AddBookModal({ onClose, onSave }: { onClose: () => void; onSave: (book: Book) => void }) {
  const [title, setTitle] = useState(""); const [author, setAuthor] = useState(""); const [description, setDescription] = useState("");
  const [genre, setGenre] = useState(""); const [year, setYear] = useState(""); const [status, setStatus] = useState<Status>("want");
  const [formats, setFormats] = useState<Format[]>([]); const [cover, setCover] = useState<string>(); const [startedAt, setStartedAt] = useState("");
  const toggleFormat = (format: Format) => setFormats((all) => all.includes(format) ? all.filter((item) => item !== format) : [...all, format]);
  const readCover = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 3_000_000) { alert("Выберите изображение до 3 МБ."); return; } const reader = new FileReader(); reader.onload = () => setCover(String(reader.result)); reader.readAsDataURL(file); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; onSave({ id: crypto.randomUUID(), title: title.trim(), author: author.trim(), description: description.trim(), genre: genre.trim(), year: year.trim(), status, formats, cover, color: colors[Math.floor(Math.random() * colors.length)], createdAt: new Date().toISOString(), startedAt: status === "reading" ? (startedAt || new Date().toISOString().slice(0,10)) : undefined }); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><header className="modal-header"><h2 id="add-title">Новая книга</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header><form className="modal-body" onSubmit={submit}><div className="upload"><div className="upload-preview">{cover ? <img src={cover} alt="Предпросмотр обложки"/> : "Своя обложка"}</div><div><p className="legend">Загрузите обложку с устройства — книга может отсутствовать в каталогах.</p><input type="file" accept="image/png,image/jpeg,image/webp" onChange={readCover} aria-label="Загрузить обложку" /></div></div><div className="form-grid" style={{marginTop:"1rem"}}><div className="form-group full"><label htmlFor="title">Название *</label><input id="title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} required /></div><div className="form-group"><label htmlFor="author">Автор</label><input id="author" className="field" value={author} onChange={(e) => setAuthor(e.target.value)} /></div><div className="form-group"><label htmlFor="year">Год</label><input id="year" className="field" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></div><div className="form-group"><label htmlFor="genre">Жанр</label><input id="genre" className="field" value={genre} onChange={(e) => setGenre(e.target.value)} /></div><div className="form-group"><label htmlFor="status">Статус</label><select id="status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{statuses.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>{status === "reading" && <div className="form-group"><label htmlFor="started">Дата начала</label><input id="started" className="field" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></div>}<div className="form-group full"><span className="legend">Форматы — можно выбрать несколько</span><div className="check-row">{([["paper","Бумажная"],["ebook","Электронная"],["audio","Аудиокнига"]] as Array<[Format,string]>).map(([value,label]) => <label className="check-chip" key={value}><input type="checkbox" checked={formats.includes(value)} onChange={() => toggleFormat(value)}/>{label}</label>)}</div></div><div className="form-group full"><label htmlFor="description">Описание</label><textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Можно заполнить сейчас или вернуться позже" /></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">Поставить на полку</button></div></form></section></div>;
}

function BookModal({ book, onClose, onDelete }: { book: Book; onClose: () => void; onDelete: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="book-title"><header className="modal-header"><h2>Книга на полке</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть">✕</button></header><div className="modal-body"><div className="book-detail"><div className="detail-cover" style={{ "--cover-color": book.color } as React.CSSProperties}>{book.cover ? <img src={book.cover} alt={`Обложка книги «${book.title}»`}/> : book.title}</div><div className="detail-copy"><h3 id="book-title">{book.title}</h3><p className="author">{book.author || "Автор не указан"}{book.year ? ` · ${book.year}` : ""}</p><div className="tags"><span className="tag">{statuses.find(([value]) => value === book.status)?.[1]}</span>{book.genre && <span className="tag">{book.genre}</span>}{book.formats.map((format) => <span className="tag" key={format}>{format === "paper" ? "Бумажная" : format === "ebook" ? "Электронная" : "Аудиокнига"}</span>)}</div><p className="description">{book.description || "Описание пока не добавлено."}</p></div></div><div className="modal-actions"><button className="secondary-button danger" onClick={onDelete}>Удалить</button><button className="primary-button" onClick={onClose}>Закрыть</button></div></div></section></div>;
}

function bookWord(count: number) { const mod10 = count % 10, mod100 = count % 100; if (mod10 === 1 && mod100 !== 11) return "книга"; if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "книги"; return "книг"; }
