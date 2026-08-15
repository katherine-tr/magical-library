import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "../../auth";

type RuntimeEnv = { COVERS: R2Bucket };
const allowedTypes = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

export async function POST(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  let body: { dataUrl?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный файл" }, { status: 400 }); }
  if (typeof body.dataUrl !== "string") return NextResponse.json({ error: "Файл не найден" }, { status: 400 });
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i.exec(body.dataUrl);
  if (!match) return NextResponse.json({ error: "Поддерживаются JPG, PNG и WebP" }, { status: 415 });
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (bytes.byteLength > 5 * 1024 * 1024) return NextResponse.json({ error: "Обложка должна быть меньше 5 МБ" }, { status: 413 });
  const id = `${crypto.randomUUID()}.${allowedTypes.get(match[1].toLowerCase())}`;
  await (env as unknown as RuntimeEnv).COVERS.put(`${user.id}/${id}`, bytes, { httpMetadata: { contentType: match[1], cacheControl: "private, max-age=86400" } });
  return NextResponse.json({ url: `/api/covers/${encodeURIComponent(id)}` });
}
