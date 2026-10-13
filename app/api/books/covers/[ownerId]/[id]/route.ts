import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { currentUser, database } from "../../../../../auth";

type RuntimeEnv = { COVERS: R2Bucket };

export async function GET(request: NextRequest, context: { params: Promise<{ ownerId: string; id: string }> }) {
  if (!await currentUser(request)) return new NextResponse(null, { status: 401 });
  const { ownerId, id } = await context.params;
  if (!/^[a-f0-9-]+$/i.test(ownerId) || !/^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(id)) return new NextResponse(null, { status: 404 });
  const catalogCover = `/api/books/covers/${ownerId}/${id}`;
  const exists = await database().prepare("SELECT 1 AS found FROM catalog_books WHERE cover = ?1 LIMIT 1").bind(catalogCover).first<{ found: number }>();
  if (!exists) return new NextResponse(null, { status: 404 });
  const object = await (env as unknown as RuntimeEnv).COVERS.get(`${ownerId}/${id}`);
  if (!object) return new NextResponse(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=86400");
  return new NextResponse(object.body, { headers });
}
