"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Status = { status: string; mode: string; active_version: string };

const NAV = [
  { href: "/", label: "Site risk", hint: "heatmap" },
  { href: "/feed", label: "Reports", hint: "all 750" },
  { href: "/queue", label: "Review queue", hint: "flywheel intake", badge: true },
  { href: "/sandbox", label: "Sandbox", hint: "analyze a report" },
  { href: "/ingest", label: "Ingest", hint: "bulk upload" },
  { href: "/model", label: "Model insight", hint: "continual learning" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<number | null>(null);

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

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r bg-[var(--ink-900)] border-[var(--line)]">
        <div className="border-b border-[var(--line)] px-4 py-4">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-extrabold tracking-tight">
              Anvaya<span className="text-[var(--caution)]">X</span>
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-[var(--faint)]">
            SIF precursor intelligence · Oil India HSSE
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[var(--ink-800)] text-[var(--chalk)]"
                    : "text-[var(--dim)] hover:bg-[var(--ink-850)] hover:text-[var(--chalk)]"
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-y-0 left-0 w-[2px]"
                    style={{ background: "var(--caution)" }}
                    aria-hidden
                  />
                )}
                <span className="font-medium">{item.label}</span>
                {item.badge && queue !== null && queue > 0 && (
                  <span
                    className="num rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold"
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
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${offline ? "" : "dot-live"}`}
              style={{ background: offline ? "var(--tier-asif)" : "var(--tier-nm)" }}
              aria-hidden
            />
            <span className="text-[11px] text-[var(--dim)]">
              {offline ? "ML service offline" : `model ${status?.active_version ?? "…"}`}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-[var(--faint)]">
            {offline
              ? "routes fall back to cached verdicts"
              : status?.mode === "transformer"
                ? "LoRA classifier · rules · embeddings"
                : "rules-only fallback mode"}
          </p>
        </div>
      </aside>

      <main className="ml-56 min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
