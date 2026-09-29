"use client";

/* Chart 3 — weekly trend. aSIF+pSIF and recordable counts per ISO week,
 * with a dashed trailing 4-week moving average over the SIF series. Point
 * clicks open the feed filtered to that week; an sr-only data table gives
 * keyboard users the same links (and keeps the chart non-colour-only). */
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ChartCard from "@/components/charts/ChartCard";
import { LINE_HEX, TIER_HEX, fmtNum } from "@/lib/ui";
import type { WeeklyTrendData } from "@/db/queries/overview";

type Props = { data: WeeklyTrendData; site: string | null };

function weekHref(site: string | null, key: string): string {
  const sp = new URLSearchParams();
  if (site) sp.set("site", site);
  sp.set("from", key);
  const to = new Date(Date.parse(key) + 6 * 86_400_000).toISOString().slice(0, 10);
  sp.set("to", to);
  return `/feed?${sp.toString()}`;
}

export default function WeeklyTrend({ data, site }: Props) {
  const rows = data.buckets;
  const maxSif = Math.max(...rows.map((r) => r.sif), 1);
  const tone = data.recentSif > data.priorSif ? "warn" : "neutral";

  return (
    <ChartCard
      question="Is SIF pressure trending up or down?"
      takeaway={data.takeaway}
      n={rows.reduce((s, r) => s + r.total, 0)}
      tone={tone}
      className="lg:col-span-2"
    >
      <div className="h-[230px] w-full" role="img" aria-label={`Weekly SIF trend across ${rows.length} weeks, peak ${maxSif} reports in one week`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={LINE_HEX.line} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: LINE_HEX.faint }}
              tickLine={false}
              axisLine={{ stroke: LINE_HEX.lineStrong }}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: LINE_HEX.faint }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              formatter={(v, name) => [fmtNum(Number(v)), String(name)]}
              labelFormatter={(l) => `Week ${l}`}
              contentStyle={{ fontSize: 12, borderRadius: 3, border: `1px solid ${LINE_HEX.lineStrong}`, background: "#fff", color: LINE_HEX.chalk }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: LINE_HEX.dim }}>{v}</span>} />
            <Line
              type="monotone"
              dataKey="sif"
              name="aSIF + pSIF"
              stroke={TIER_HEX.psif}
              strokeWidth={2.5}
              dot={{ r: 3, fill: TIER_HEX.psif, stroke: "#fff" }}
              activeDot={{ r: 5, cursor: "pointer" }}
              onClick={(p) => {
                const point = p as unknown as { payload?: { key?: string } };
                if (point?.payload?.key) window.location.href = weekHref(site, point.payload.key);
              }}
            />
            <Line
              type="monotone"
              dataKey="sifMa"
              name="4-week avg"
              stroke={TIER_HEX.asif}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="recordable"
              name="Recordable"
              stroke={TIER_HEX.recordable}
              strokeWidth={2}
              dot={{ r: 2.5, fill: TIER_HEX.recordable, stroke: "#fff" }}
              activeDot={{ r: 5, cursor: "pointer" }}
              onClick={(p) => {
                const point = p as unknown as { payload?: { key?: string } };
                if (point?.payload?.key) window.location.href = weekHref(site, point.payload.key);
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Keyboard/AT path to the same click-through each point offers.
          The table must sit inside a sr-only *div*: sr-only's width:1px +
          overflow:hidden don't apply to table elements (their used width is
          content-driven), which would otherwise add page-wide horizontal scroll. */}
      <div className="sr-only">
        <table>
        <caption>Weekly counts — open a week in the report feed</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>aSIF + pSIF</th>
            <th>Recordable</th>
            <th>Total</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{r.sif}</td>
              <td>{r.recordable}</td>
              <td>{r.total}</td>
              <td>
                <Link href={weekHref(site, r.key)} tabIndex={0}>
                  View week {r.label}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
