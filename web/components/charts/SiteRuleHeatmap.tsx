"use client";

/* Chart 6 — site × rule density heatmap. Cell colour = precursor density
 * (per 100 site reports); a cell is "escalating" when its last-4-week density
 * clears the prior 4 weeks by ESCALATION_DELTA (named constant, tested).
 * Selecting a cell (click or Enter) reveals its drill-down — top activity, top
 * missing safeguard, 12-week sparkline — so "worst site → rule → activity →
 * safeguard" is two clicks. Each cell also links straight to the filtered feed.
 * Escalation is marked with a ▲ glyph, never colour alone. */
import Link from "next/link";
import { useState } from "react";

import ChartCard from "@/components/charts/ChartCard";
import { fmtNum } from "@/lib/ui";
import type { HeatmapData } from "@/db/queries/overview";

type Props = { data: HeatmapData; site: string | null; weeks: number };

/** Density bands mirroring the home heatmap ladder (per-100). */
function densityBand(d: number): { bg: string; ink: string } {
  if (d >= 55) return { bg: "#7a1f17", ink: "#ffffff" };
  if (d >= 45) return { bg: "#c23a2b", ink: "#ffffff" };
  if (d >= 30) return { bg: "#c2703f", ink: "#ffffff" };
  if (d >= 20) return { bg: "#a16207", ink: "#ffffff" };
  if (d > 0) return { bg: "#0f766e", ink: "#ffffff" };
  return { bg: "#eef1f4", ink: "#5b6f84" };
}

function cellHref(site: string, rule: string): string {
  const sp = new URLSearchParams({ site, rule });
  return `/feed?${sp.toString()}`;
}

function Sparkline({ points }: { points: { label: string; n: number }[] }) {
  const w = 120;
  const h = 28;
  const max = Math.max(...points.map((p) => p.n), 1);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p.n / max) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label={`12-week trend for this cell, peak ${max} reports`} className="max-w-full">
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
    </svg>
  );
}

export default function SiteRuleHeatmap({ data }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const cellMap = new Map(data.cells.map((c) => [`${c.site}\u0000${c.rule}`, c]));
  const selected = selectedKey ? cellMap.get(selectedKey) ?? null : null;

  return (
    <ChartCard
      question="Where is risk concentrating, site by rule?"
      takeaway={data.takeaway}
      n={data.cells.reduce((s, c) => s + c.n, 0)}
      tone={data.cells.some((c) => c.escalating) ? "warn" : "neutral"}
      className="lg:col-span-2"
      action={
        <span className="flex items-center gap-1.5 text-xs text-[var(--faint)]">
          <span aria-hidden className="text-[var(--tier-asif)]">▲</span> escalating
        </span>
      }
    >
      {data.siteNames.length === 0 ? (
        <p className="text-xs text-[var(--faint)]">No site × rule pairs in this window.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" style={{ minWidth: 120 + data.rules.length * 64 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[var(--ink-900)] p-1.5 text-left font-medium text-[var(--faint)]">Site</th>
                  {data.rules.map((r) => (
                    <th key={r} className="p-1.5 text-center font-medium text-[var(--faint)]" style={{ maxWidth: 64 }}>
                      <span className="line-clamp-2" title={r}>{r}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.siteNames.map((s) => (
                  <tr key={s}>
                    <th scope="row" className="sticky left-0 bg-[var(--ink-900)] p-1.5 text-left font-medium text-[var(--dim)]">
                      <span className="line-clamp-2" title={s}>{s}</span>
                    </th>
                    {data.rules.map((r) => {
                      const c = cellMap.get(`${s}\u0000${r}`);
                      const key = `${s}\u0000${r}`;
                      if (!c) {
                        return (
                          <td key={r} className="p-1">
                            <div className="h-8 rounded-[2px] bg-[var(--ink-850)]" aria-label={`${s}, ${r}: no reports`} />
                          </td>
                        );
                      }
                      const band = densityBand(c.density);
                      const isSel = selectedKey === key;
                      return (
                        <td key={r} className="p-1">
                          <button
                            type="button"
                            aria-pressed={isSel}
                            aria-label={`${s}, ${r}: density ${c.density} per 100, ${c.n} reports${c.escalating ? ", escalating" : ""}. Show details.`}
                            onClick={() => setSelectedKey(isSel ? null : key)}
                            className="num flex h-8 w-full items-center justify-center rounded-[2px] text-[11px] font-semibold transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                            style={{ background: band.bg, color: band.ink, boxShadow: isSel ? "0 0 0 2px var(--brand)" : undefined }}
                          >
                            {c.n}
                            {c.escalating && <span aria-hidden className="ml-0.5">▲</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="mt-3 rounded-[3px] border border-[var(--line)] bg-[var(--ink-850)] p-3" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="label-micro text-[var(--brand)]">
                    {selected.site} · {selected.rule}
                  </p>
                  <p className="mt-1 text-xs text-[var(--dim)]">
                    <span className="num font-semibold text-[var(--chalk)]">{fmtNum(selected.n)}</span> reports ·{" "}
                    <span className="num">{selected.density}</span>/100 · last 4 wks{" "}
                    <span className="num">{selected.recent}</span> vs prior <span className="num">{selected.prior}</span>
                    {selected.escalating && (
                      <span className="ml-1.5 font-semibold text-[var(--tier-asif)]">▲ escalating</span>
                    )}
                  </p>
                </div>
                <Link href={cellHref(selected.site, selected.rule)} className="btn-ghost shrink-0">
                  Open in feed
                </Link>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <DrillList title="Top activity" items={selected.drill.activities} empty="—" />
                <DrillList title="Top missing safeguard" items={selected.drill.barriers} empty="None named" />
                <div>
                  <p className="label-micro text-[var(--faint)]">12-week trend</p>
                  <div className="mt-1.5">
                    <Sparkline points={selected.drill.spark} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </ChartCard>
  );
}

function DrillList({ title, items, empty }: { title: string; items: { label: string; n: number }[]; empty: string }) {
  return (
    <div>
      <p className="label-micro text-[var(--faint)]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-[var(--faint)]">{empty}</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1 text-xs">
          {items.map((it) => (
            <li key={it.label} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[var(--dim)]">{it.label}</span>
              <span className="num shrink-0 text-[var(--chalk)]">{it.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
