import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "../../../auth";

type RuntimeEnv = { COVERS: R2Bucket };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(request);
  if (!user) return new NextResponse(null, { status: 401 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(id)) return new NextResponse(null, { status: 404 });
  const object = await (env as unknown as RuntimeEnv).COVERS.get(`${user.id}/${id}`);
  if (!object) return new NextResponse(null, { status: 404 });
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("ETag", object.httpEtag); headers.set("Cache-Control", "private, max-age=86400");
  return new NextResponse(object.body, { headers });
}
