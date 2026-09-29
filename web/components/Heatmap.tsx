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
  topRules?: string[];
};

type Props = {
  sites: SiteRow[];
  /** System-wide SIF-potential density — drawn as the baseline tick on bars. */
  baseline?: number;
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

/* Score-banded bar colours (HSSE scale): 30–45 terracotta, 45–55 red, 55+ dark red.
 * Below 30 keeps the tier ladder so low-risk sites stay quiet. */
export function densityColor(d: number) {
  if (d >= 55) return "var(--risk-dark)";
  if (d >= 45) return "var(--risk-red)";
  if (d >= 30) return "var(--risk-amber)";
  if (d >= 20) return "var(--tier-rec)";
  return "var(--tier-nm)";
}
/* Same ladder for text on paper: raw amber fails AA on white, so the
 * 30–45 band swaps to its darkened ink twin. Bars keep the vivid fill. */
export function densityInk(d: number) {
  return d >= 30 && d < 45 ? "var(--risk-amber-ink)" : densityColor(d);
}

export default function Heatmap({ sites, baseline }: Props) {
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="min-w-0 font-display text-sm font-semibold text-[var(--chalk)]">
          {mode === "density" ? "Ranked by SIF-potential density" : "Ranked by rate of change"}
        </h2>
        <div
          className="flex min-w-0 overflow-hidden rounded-[3px] border border-[var(--line-strong)]"
          role="group"
          aria-label="Sort sites"
        >
          <button
            type="button"
            onClick={() => setMode("density")}
            aria-pressed={mode === "density"}
            className={`min-w-0 shrink truncate whitespace-nowrap px-3 py-1 text-xs font-medium transition-colors ${
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
            className={`min-w-0 shrink truncate whitespace-nowrap border-l border-[var(--line-strong)] px-3 py-1 text-xs font-medium transition-colors ${
              mode === "delta"
                ? "bg-[var(--ink-800)] text-[var(--chalk)]"
                : "text-[var(--faint)] hover:text-[var(--dim)]"
            }`}
          >
            Escalating risk
          </button>
        </div>
      </div>

      <ul className="panel mt-3 space-y-px overflow-hidden">
        {sorted.map((s) => {
          const t = TREND[s.trend] ?? TREND.stable;
          const width =
            mode === "density"
              ? (s.density / dMax) * 100
              : (Math.abs(s.deltaDensity) / deltaMax) * 100;
          const barColor =
            mode === "density"
              ? densityColor(s.density)
              : s.deltaDensity > 0
                ? "var(--tier-asif)"
                : "var(--tier-nm)";
          // Where the system-wide average falls on this bar's scale (density mode only).
          const baselinePct =
            baseline !== undefined && mode === "density"
              ? Math.min(99, Math.max(1, (baseline / dMax) * 100))
              : null;
          return (
            <li key={s.name}>
              <Link
                href={`/site/${encodeURIComponent(s.name)}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-l-2 px-4 py-3 transition-colors hover:bg-[var(--ink-850)] sm:grid-cols-[11rem_minmax(0,1fr)_auto_auto]"
                style={{ borderLeftColor: mode === "density" ? densityColor(s.density) : "var(--line)" }}
                aria-label={`${s.name}: ${s.density} SIF-potential per 100 reports, ${t.label}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--chalk)] group-hover:text-[var(--brand)]">
                    {s.name}
                  </p>
                  <p className="truncate text-xs text-[var(--faint)]">{s.region}</p>
                  <p className="num text-xs text-[var(--faint)]">
                    {s.totalReports} reports · {s.sifPositive} SIF-potential
                  </p>
                  {!!s.topRules?.length && (
                    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Top IOGP rule tags">
                      {s.topRules.map((r) => (
                        <li
                          key={r}
                          className="rounded-full border border-[var(--line)] bg-[var(--ink-850)] px-1.5 py-px text-xs leading-4 text-[var(--dim)]"
                        >
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div
                  className="relative hidden h-2 overflow-hidden rounded-full bg-[var(--ink-800)] sm:block"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(width, 2)}%`, background: barColor }}
                  />
                  {baseline !== undefined && baselinePct !== null && (
                    <span
                      className="absolute inset-y-0 w-[2px]"
                      style={{ left: `${baselinePct}%`, background: "color-mix(in srgb, var(--chalk) 55%, transparent)" }}
                      title={`System average ${baseline.toFixed(1)}/100`}
                    />
                  )}
                </div>

                <p className="num text-right text-lg font-semibold" style={{ color: mode === "density" ? densityInk(s.density) : barColor }}>
                  {mode === "density" ? (
                    <>
                      {s.density.toFixed(1)}
                      <span className="ml-1 text-xs font-normal text-[var(--faint)]">/100</span>
                    </>
                  ) : (
                    <>
                      {s.deltaDensity > 0 ? "+" : ""}
                      {s.deltaDensity.toFixed(1)}
                      <span className="ml-1 text-xs font-normal text-[var(--faint)]">pp</span>
                    </>
                  )}
                </p>

                <p className="flex items-center justify-end gap-1.5 text-xs" style={{ color: t.color }}>
                  <span aria-hidden>{t.glyph}</span>
                  <span className="hidden md:inline">{t.label}</span>
                  {s.trend !== "stable" && (
                    <span className="num text-xs text-[var(--faint)]">
                      ({s.deltaDensity > 0 ? "+" : ""}
                      {s.deltaDensity.toFixed(1)} pp)
                    </span>
                  )}
                </p>
              </Link>
            </li>
          );
        })}
        {!sorted.length && (
          <li className="px-4 py-8 text-center text-sm text-[var(--faint)]">
            No sites yet — ingest reports to populate the heatmap.
          </li>
        )}
      </ul>
    </section>
  );
}
