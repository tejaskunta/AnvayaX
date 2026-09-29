"use client";

/* Chart 2 — tier mix donut. Count per tier, total in the centre. Recharts
 * owns the arc geometry; the HTML legend below carries the same numbers as
 * text + links, so the chart is never colour-only and stays keyboard-navigable. */
import Link from "next/link";
import { Pie, PieChart, Cell, ResponsiveContainer } from "recharts";

import ChartCard from "@/components/charts/ChartCard";
import { TIER_HEX, TIER_LABEL, fmtNum } from "@/lib/ui";
import type { TierMixData } from "@/db/queries/overview";

type Props = { data: TierMixData; site: string | null; weeks: number };

function feedHref(site: string | null, tier: string): string {
  const sp = new URLSearchParams({ tier });
  if (site) sp.set("site", site);
  return `/feed?${sp.toString()}`;
}

export default function TierDonut({ data, site }: Props) {
  const chartData = data.slices.filter((s) => s.n > 0);
  return (
    <ChartCard
      question="What is the severity mix?"
      takeaway={data.takeaway}
      n={data.total}
    >
      <div className="relative mx-auto h-[190px] w-full max-w-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="n"
              nameKey="tier"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
              strokeWidth={2}
              stroke="#ffffff"
              aria-label="Tier mix donut"
            >
              {chartData.map((s) => (
                <Cell key={s.tier} fill={TIER_HEX[s.tier]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-[26px] font-semibold leading-none text-[var(--chalk)]">{fmtNum(data.total)}</span>
          <span className="label-micro mt-1 text-[var(--faint)]">reports</span>
        </div>
      </div>
      {/* Legend = accessible mirror: label, count, share — and a click target. */}
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {data.slices.map((s) => (
          <li key={s.tier}>
            <Link
              href={feedHref(site, s.tier)}
              className="flex items-center gap-2 rounded-[2px] px-1 py-0.5 hover:bg-[var(--ink-850)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              aria-label={`${TIER_LABEL[s.tier]}: ${s.n} reports, open in feed`}
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: TIER_HEX[s.tier] }} />
              <span className="min-w-0 flex-1 truncate text-[var(--dim)]">{TIER_LABEL[s.tier]}</span>
              <span className="num text-[var(--chalk)]">{fmtNum(s.n)}</span>
              <span className="num w-9 text-right text-[var(--faint)]">{data.total ? `${Math.round((s.n / data.total) * 100)}%` : "—"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
