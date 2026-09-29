import { NextResponse } from "next/server";

import { ROLE_COOKIE, USER_COOKIE } from "@/lib/auth";

/* POST /api/auth/logout — clear the demo cookies and go back to /login. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ROLE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(USER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
