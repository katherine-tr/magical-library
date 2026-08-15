import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "../../../auth";

export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  return NextResponse.json(user ? { authenticated: true, user: { username: user.username } } : { authenticated: false }, { status: user ? 200 : 401 });
}
