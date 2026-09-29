import { NextRequest, NextResponse } from "next/server";

import { parseRole, ROLES, ROLE_COOKIE, USER_COOKIE } from "@/lib/auth";

/* POST /api/auth/login { role } — demo role switch, no credentials. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { role?: string } | null;
  const role = parseRole(body?.role);
  if (!role) {
    return NextResponse.json({ error: "role must be admin | supervisor | hse" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, role, user: ROLES[role].user });
  const maxAge = 60 * 60 * 8; // one demo day
  res.cookies.set(ROLE_COOKIE, role, { path: "/", maxAge, sameSite: "lax" });
  res.cookies.set(USER_COOKIE, ROLES[role].user, { path: "/", maxAge, sameSite: "lax" });
  return res;
}

export async function GET() {
  return NextResponse.json({ error: "use POST" }, { status: 405 });
}
