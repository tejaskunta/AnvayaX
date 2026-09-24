"use client";

/* Site risk heatmap: bar-ranked sites with a sort toggle between absolute
 * SIF density and rate-of-change (the escalating-risk lens). Rows link to
 * the drill-down screen. */
import Link from "next/link";
import { useState } from "react";

type SiteRow = {
  name: string;
  region: string;
  totalReports: number;
  sifPositive: number;
  density: number;
  trend: string;
  deltaDensity: number;
};

const TREND: Record<string, { glyph: string; color: string; label: string }> = {
  rising: { glyph: "▲", color: "var(--tier-asif)", label: "rising" },
  falling: { glyph: "▼", color: "var(--tier-nm)", label: "falling" },
  stable: { glyph: "—", color: "var(--faint)", label: "stable" },
};

function maxDensity(sites: SiteRow[]) {
  return Math.max(1, ...sites.map((s) => s.density));
}
function maxAbsDelta(sites: SiteRow[]) {
  return Math.max(1, ...sites.map((s) => Math.abs(s.deltaDensity)));
}

export default function Heatmap({ sites }: { sites: SiteRow[] }) {
  const [mode, setMode] = useState<"density" | "delta">("density");

  const sorted = [...sites].sort((a, b) =>
    mode === "density"
      ? b.density - a.density
      : Math.abs(b.deltaDensity) - Math.abs(a.deltaDensity) || b.density - a.density
  );
  const dMax = maxDensity(sites);
  const deltaMax = maxAbsDelta(sites);

  return (
    <section className="mt-6" aria-label="Site risk ranking">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
          {mode === "density" ? "Ranked by SIF-potential density" : "Ranked by rate of change"}
        </h2>
        <div
          className="flex overflow-hidden rounded-[3px] border border-[var(--line-strong)]"
          role="group"
          aria-label="Sort sites"
        >
          <button
            type="button"
            onClick={() => setMode("density")}
            aria-pressed={mode === "density"}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "density"
                ? "bg-[var(--ink-800)] text-[var(--chalk)]"
                : "text-[var(--faint)] hover:text-[var(--dim)]"
            }`}
          >
            Absolute risk
          </button>
          <button
            type="button"
            onClick={() => setMode("delta")}
            aria-pressed={mode === "delta"}
            className={`border-l border-[var(--line-strong)] px-3 py-1 text-xs font-medium transition-colors ${
              mode === "delta"
                ? "bg-[var(--ink-800)] text-[var(--chalk)]"
                : "text-[var(--faint)] hover:text-[var(--dim)]"
            }`}
          >
            Escalating risk
          </button>
        </div>
      </div>

      <ul className="mt-3 space-y-px overflow-hidden rounded-[3px] border border-[var(--line)]">
        {sorted.map((s) => {
          const t = TREND[s.trend] ?? TREND.stable;
          const width =
            mode === "density"
              ? (s.density / dMax) * 100
              : (Math.abs(s.deltaDensity) / deltaMax) * 100;
          const barColor =
            mode === "density"
              ? s.density >= 40
                ? "var(--tier-asif)"
                : s.density >= 30
                  ? "var(--tier-psif)"
                  : s.density >= 20
                    ? "var(--tier-rec)"
                    : "var(--tier-nm)"
              : s.deltaDensity > 0
                ? "var(--tier-asif)"
                : "var(--tier-nm)";
          return (
            <li key={s.name}>
              <Link
                href={`/site/${encodeURIComponent(s.name)}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 bg-[var(--ink-900)] px-4 py-3 transition-colors hover:bg-[var(--ink-850)] sm:grid-cols-[11rem_minmax(0,1fr)_auto_auto]"
                aria-label={`${s.name}: ${s.density} SIF-potential per 100 reports, ${t.label}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--chalk)] group-hover:text-[var(--caution)]">
                    {s.name}
                  </p>
                  <p className="text-[11px] text-[var(--faint)]">
                    {s.region} · {s.totalReports} reports · {s.sifPositive} SIF-potential
                  </p>
                </div>

                <div className="hidden h-2 overflow-hidden rounded-full bg-[var(--ink-800)] sm:block" aria-hidden>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(width, 2)}%`, background: barColor }}
                  />
                </div>

                <p className="num text-right text-lg font-semibold" style={{ color: barColor }}>
                  {mode === "density" ? (
                    <>
                      {s.density.toFixed(1)}
                      <span className="ml-1 text-[10px] font-normal text-[var(--faint)]">/100</span>
                    </>
                  ) : (
                    <>
                      {s.deltaDensity > 0 ? "+" : ""}
                      {s.deltaDensity.toFixed(1)}
                      <span className="ml-1 text-[10px] font-normal text-[var(--faint)]">pp</span>
                    </>
                  )}
                </p>

                <p className="flex items-center justify-end gap-1.5 text-xs" style={{ color: t.color }}>
                  <span aria-hidden>{t.glyph}</span>
                  <span className="hidden md:inline">{t.label}</span>
                </p>
              </Link>
            </li>
          );
        })}
        {!sorted.length && (
          <li className="bg-[var(--ink-900)] px-4 py-8 text-center text-sm text-[var(--faint)]">
            No sites yet — ingest reports to populate the heatmap.
          </li>
        )}
      </ul>
    </section>
  );
}
