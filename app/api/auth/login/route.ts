import { NextRequest, NextResponse } from "next/server";
import { database, newSessionToken, sessionCookie, sessionExpiry, sha256, verifyPassword } from "../../../auth";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function configuredCredentials() {
  const username = process.env.LIBRARY_USERNAME?.trim();
  const passwordHash = process.env.LIBRARY_PASSWORD_HASH?.trim();
  return username && passwordHash ? { username, passwordHash } : null;
}

export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const username = typeof body.username === "string" ? body.username.trim().toLocaleLowerCase("en") : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || username.length > 80 || password.length > 256) return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 });

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const attemptKey = await sha256(`${ip}|${username}`);
  const now = Date.now();
  const attempts = await database().prepare("SELECT attempts, window_started_at AS windowStartedAt, blocked_until AS blockedUntil FROM login_attempts WHERE key = ?1")
    .bind(attemptKey).first<{ attempts: number; windowStartedAt: number; blockedUntil: number }>();
  if (attempts && attempts.blockedUntil > now) return NextResponse.json({ error: "Слишком много попыток. Попробуйте через 15 минут." }, { status: 429 });

  const configured = configuredCredentials();
  let user = await database().prepare("SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?1")
    .bind(username).first<{ id: string; username: string; passwordHash: string }>();
  const candidateHash = user?.passwordHash || (configured?.username.toLocaleLowerCase("en") === username ? configured.passwordHash : "");
  const valid = candidateHash ? await verifyPassword(password, candidateHash) : false;

  if (!valid) {
    const freshWindow = !attempts || now - attempts.windowStartedAt > WINDOW_MS;
    const nextAttempts = freshWindow ? 1 : attempts.attempts + 1;
    const blockedUntil = nextAttempts >= MAX_ATTEMPTS ? now + WINDOW_MS : 0;
    await database().prepare(`INSERT INTO login_attempts (key, attempts, window_started_at, blocked_until) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
      .bind(attemptKey, nextAttempts, freshWindow ? now : attempts!.windowStartedAt, blockedUntil).run();
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  if (!user) {
    const id = crypto.randomUUID();
    await database().batch([
      database().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)").bind(id, username, candidateHash, now),
      database().prepare("INSERT INTO library_state (user_id, order_json, order_updated_at) VALUES (?1, '[]', 0)").bind(id),
    ]);
    user = { id, username, passwordHash: candidateHash };
  }

  const token = newSessionToken();
  await database().batch([
    database().prepare("DELETE FROM login_attempts WHERE key = ?1").bind(attemptKey),
    database().prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    database().prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256(token), user.id, sessionExpiry(), now),
  ]);
  const response = NextResponse.json({ user: { username: user.username } });
  response.cookies.set(sessionCookie(token));
  return response;
}
