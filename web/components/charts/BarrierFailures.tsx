"use client";

/* Chart 5 — top barrier failures among aSIF/pSIF reports only. Top 6 bars,
 * null barriers skipped, extractor artifacts filtered server-side. Counts
 * only (never percentages) — the named-barrier population is small.
 * Each bar links to /feed?barrier=…&site=… */
import Link from "next/link";

import ChartCard from "@/components/charts/ChartCard";
import { TIER_HEX, fmtNum } from "@/lib/ui";
import type { BarrierData } from "@/db/queries/overview";

type Props = { data: BarrierData; site: string | null };

function barrierHref(site: string | null, barrier: string): string {
  const sp = new URLSearchParams({ barrier });
  if (site) sp.set("site", site);
  return `/feed?${sp.toString()}`;
}

export default function BarrierFailures({ data, site }: Props) {
  const max = Math.max(...data.bars.map((b) => b.n), 1);
  return (
    <ChartCard
      question="Which safeguards are missing in SIF events?"
      takeaway={data.takeaway}
      n={data.named}
      tone={data.named > 0 && data.named < 20 ? "warn" : "neutral"}
    >
      {data.bars.length === 0 ? (
        <p className="text-xs text-[var(--faint)]">No SIF report in this window names a barrier failure.</p>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Barrier failures in aSIF and pSIF reports">
          {data.bars.map((b) => (
            <li key={b.barrier}>
              <Link
                href={barrierHref(site, b.barrier)}
                className="group block rounded-[2px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                aria-label={`Barrier "${b.barrier}": ${b.n} SIF reports. Open in feed.`}
              >
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-[var(--dim)] group-hover:text-[var(--chalk)]">{b.barrier}</span>
                  <span className="num shrink-0 text-[var(--chalk)]">{fmtNum(b.n)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full" style={{ background: `color-mix(in srgb, ${TIER_HEX.psif} 12%, #f2f5f8)` }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max((b.n / max) * 100, 3)}%`, background: TIER_HEX.psif }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
