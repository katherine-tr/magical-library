import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { database, newSessionToken, sessionCookie, sessionExpiry, sha256, verifyPassword } from "../../../auth";

function configuredCredentials() {
  const runtime = env as unknown as { LIBRARY_USERNAME?: string; LIBRARY_PASSWORD_HASH?: string };
  const username = runtime.LIBRARY_USERNAME?.trim();
  const passwordHash = runtime.LIBRARY_PASSWORD_HASH?.trim();
  return username && passwordHash ? { username, passwordHash } : null;
}

export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const username = typeof body.username === "string" ? body.username.trim().toLocaleLowerCase("en") : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || username.length > 80 || password.length > 256) return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 });

  const now = Date.now();
  const configured = configuredCredentials();
  let user = await database().prepare("SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?1")
    .bind(username).first<{ id: string; username: string; passwordHash: string }>();
  const candidateHash = user?.passwordHash || (configured?.username.toLocaleLowerCase("en") === username ? configured.passwordHash : "");
  const valid = candidateHash ? await verifyPassword(password, candidateHash) : false;

  if (!valid) return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });

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
    database().prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    database().prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256(token), user.id, sessionExpiry(), now),
  ]);
  const response = NextResponse.json({ user: { username: user.username } });
  response.cookies.set(sessionCookie(token));
  return response;
}
