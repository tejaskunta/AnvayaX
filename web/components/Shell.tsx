"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canAccess, parseRole, ROLES, ROLE_COOKIE, USER_COOKIE, type Role } from "@/lib/auth";

type Status = { status: string; mode: string; active_version: string };

/* 16px line icons, drawn inline so the rail carries no icon dependency. */
const ICONS: Record<string, React.ReactNode> = {
  "Site risk": (
    <path d="M2 12h3v5H2zM7.5 8h3v9h-3zM13 4h3v13h-3zM18.5 10h2.5v7H18.5z" />
  ),
  Reports: (
    <path d="M4 3h9l4 4v10H4zM13 3v4h4M7 11h7M7 14h5" />
  ),
  "Review queue": (
    <path d="M4 5h10M4 9h10M4 13h6m4-1 2 2 4-4" />
  ),
  Sandbox: (
    <path d="M9 3v5l5.5 8A2.5 2.5 0 0 1 12.2 20H6.8a2.5 2.5 0 0 1-2.3-3.5L10 8V3M7 3h7" />
  ),
  Ingest: (
    <path d="M11 3v9m0 0 3.5-3.5M11 12 7.5 8.5M4 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
  ),
  "Model insight": (
    <path d="M5 5h14v14H5zM9 15V9m3 6v-4m3 4v-2M5 9h4" />
  ),
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 opacity-80"
    >
      {ICONS[name]}
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Site risk", hint: "heatmap" },
  { href: "/feed", label: "Reports", hint: "all 750" },
  { href: "/queue", label: "Review queue", hint: "flywheel intake", badge: true },
  { href: "/sandbox", label: "Sandbox", hint: "analyze a report" },
  { href: "/ingest", label: "Ingest", hint: "bulk upload" },
  { href: "/model", label: "Model insight", hint: "continual learning" },
];

function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  const syncAuth = useCallback(() => {
    setRole(parseRole(readCookie(ROLE_COOKIE)));
    setUserName(readCookie(USER_COOKIE));
  }, []);

  // Cookie-only state: refresh on navigation and on explicit auth events.
  useEffect(() => {
    syncAuth();
    const onAuth = () => syncAuth();
    window.addEventListener("anvaya:auth", onAuth);
    return () => window.removeEventListener("anvaya:auth", onAuth);
  }, [pathname, syncAuth]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setRole(null);
    setUserName(null);
    window.dispatchEvent(new Event("anvaya:auth"));
    router.replace("/login");
  };

  // Service state + live queue count. Declared before the /login early-return
  // below: React hooks must run in the same order on every render, and the
  // login screen returns early — a hook after that point is a rules-of-hooks
  // violation (and a real crash risk when navigating login -> app).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const j = (await res.json()) as Status & { queue_total?: number };
        if (!alive) return;
        setStatus(j);
        setOffline(j.status !== "ok");
        if (typeof j.queue_total === "number") setQueue(j.queue_total);
      } catch {
        if (alive) {
          setStatus(null);
          setOffline(true);
        }
      }
    };
    tick();
    const t = setInterval(tick, 30_000);
    const onQueue = () => tick();
    window.addEventListener("anvaya:queue", onQueue);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("anvaya:queue", onQueue);
    };
  }, []);

  // The sign-in screen stands alone — no rail, no chrome.
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="app-nav fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r bg-[var(--ink-900)] border-[var(--line)]">
        <div className="border-b border-[var(--line)] px-4 py-4">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-extrabold tracking-tight text-[var(--chalk)]">
              Anvaya<span className="text-[var(--accent)]">X</span>
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-4 text-[var(--faint)]">
            SIF precursor intelligence · Oil India HSSE
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary">
          {NAV.filter((item) => canAccess(role, item.href)).map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[var(--ink-800)] font-semibold text-[var(--accent)]"
                    : "text-[var(--dim)] hover:bg-[var(--ink-850)] hover:text-[var(--chalk)]"
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-y-0 left-0 w-[2px]"
                    style={{ background: "var(--accent)" }}
                    aria-hidden
                  />
                )}
                <NavIcon name={item.label} />
                <span className="min-w-0 truncate">{item.label}</span>
                {item.badge && queue !== null && queue > 0 && (
                  <span
                    className="num ml-auto rounded-[2px] px-1.5 py-0.5 text-xs font-semibold"
                    style={{
                      color: "var(--tier-psif)",
                      background: "color-mix(in srgb, var(--tier-psif) 14%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--tier-psif) 40%, transparent)",
                    }}
                    title={`${queue} reports awaiting review`}
                  >
                    {queue > 99 ? "99+" : queue}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--line)] px-4 py-3">
          {role && (
            <div className="mb-2.5 flex items-center gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-[var(--ink-800)] font-display text-xs font-bold text-[var(--accent)]"
                aria-hidden
              >
                {(ROLES[role].label.charAt(0) ?? "?").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-xs font-medium text-[var(--chalk)]">{userName}</span>
                <span className="block text-xs uppercase tracking-[0.08em] text-[var(--faint)]">
                  {ROLES[role].label}
                </span>
              </span>
              <button
                type="button"
                onClick={signOut}
                className="shrink-0 rounded-[3px] border border-[var(--line-strong)] px-1.5 py-0.5 text-xs text-[var(--dim)] transition-colors hover:bg-[var(--ink-850)] hover:text-[var(--chalk)]"
                title="Sign out of the demo"
              >
                sign out
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${offline ? "" : "dot-live"}`}
              style={{ background: offline ? "var(--tier-asif)" : "var(--tier-nm)" }}
              aria-hidden
            />
            <span className="text-xs font-medium text-[var(--chalk)]">
              {offline ? "ML service offline" : `model ${status?.active_version ?? "..."}`}
            </span>
          </div>
          <p className="mt-1 text-xs leading-4 text-[var(--faint)]">
            {offline
              ? "routes fall back to cached verdicts"
              : status?.mode === "transformer"
                ? "LoRA classifier · rules · embeddings"
                : "rules-only fallback mode"}
          </p>
        </div>
      </aside>

      <main className="ml-56 min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
