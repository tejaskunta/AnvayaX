import { NextRequest, NextResponse } from "next/server";

import { apiGate, canAccess, parseRole, ROLE_COOKIE, USER_COOKIE } from "@/lib/auth";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"],
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // DEMO_AUTH=off (.env.local / Vercel env) opens every route — for headless
  // scanners and local debugging. Delete the line or set it back to on for the
  // demo. A throwaway admin cookie is injected so the client-side nav filter
  // shows every item; sign-out only "sticks" when the hatch is removed.
  // Trimmed because hosted env values often arrive with a trailing newline.
  if ((process.env.DEMO_AUTH ?? "").trim().toLowerCase() === "off") {
    if (parseRole(req.cookies.get(ROLE_COOKIE)?.value)) return NextResponse.next();
    const res = NextResponse.next();
    res.cookies.set(ROLE_COOKIE, "admin", { path: "/", maxAge: 3600 });
    res.cookies.set(USER_COOKIE, "Demo admin", { path: "/", maxAge: 3600 });
    return res;
  }
  const role = parseRole(req.cookies.get(ROLE_COOKIE)?.value);

  // API routes: gate by the page they power; 401 JSON keeps fetch UIs sane.
  if (pathname.startsWith("/api/")) {
    if (!apiGate(role, pathname)) {
      return NextResponse.json({ error: "forbidden", role }, { status: role ? 403 : 401 });
    }
    return NextResponse.next();
  }

  // Pages: no cookie -> login; wrong role -> back to a page they can see.
  if (!role) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (!canAccess(role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
