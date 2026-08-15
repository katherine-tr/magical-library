import { NextRequest, NextResponse } from "next/server";
import { deleteCurrentSession, SESSION_COOKIE } from "../../../auth";

export async function POST(request: NextRequest) {
  await deleteCurrentSession(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
