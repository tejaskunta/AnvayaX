"use client";

/* Chart 4 — precursor density by Life-Saving Rule. Horizontal bars, descending.
 * Multi-label reports count toward every distinct rule they carry (tested in
 * lib/overview.ts). With a site filter on, bars normalise per 1,000 reports;
 * otherwise raw counts (system-wide totals are already comparable).
 * Each bar is a link → /feed?rule=…&site=… */
import Link from "next/link";

import ChartCard from "@/components/charts/ChartCard";
import { LINE_HEX, fmtNum } from "@/lib/ui";
import type { RuleDensityData } from "@/db/queries/overview";

type Props = { data: RuleDensityData; site: string | null };

function ruleHref(site: string | null, rule: string): string {
  const sp = new URLSearchParams({ rule });
  if (site) sp.set("site", site);
  return `/feed?${sp.toString()}`;
}

export default function RuleDensity({ data, site }: Props) {
  const max = Math.max(...data.bars.map((b) => b.n), 1);
  const normalized = site !== null && data.bars.some((b) => b.per1000 !== null);
  return (
    <ChartCard
      question="Which Life-Saving Rules are failing most often?"
      takeaway={data.takeaway}
      n={data.total}
    >
      <ul className="flex flex-col gap-2.5" aria-label="Reports per safety rule">
        {data.bars.map((b) => (
          <li key={b.rule}>
            <Link
              href={ruleHref(site, b.rule)}
              className="group block rounded-[2px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              aria-label={`${b.rule}: ${b.n} reports${b.per1000 !== null ? `, ${b.per1000} per 1000` : ""}. Open in feed.`}
            >
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-[var(--dim)] group-hover:text-[var(--chalk)]">{b.rule}</span>
                <span className="num shrink-0 text-[var(--chalk)]">
                  {fmtNum(b.n)}
                  {b.per1000 !== null && <span className="ml-1.5 text-[var(--faint)]">({fmtNum(b.per1000)}/1k)</span>}
                </span>
              </div>
              <div
                className="mt-1 h-2 rounded-full"
                style={{ background: `color-mix(in srgb, ${LINE_HEX.brand} 12%, ${LINE_HEX.ink850})` }}
                role="presentation"
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max((b.n / max) * 100, 2)}%`, background: LINE_HEX.brand }}
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {normalized && (
        <p className="mt-2 text-xs text-[var(--faint)]">Figures in brackets = reports per 1,000 (site-normalised).</p>
      )}
    </ChartCard>
  );
}
