import Link from "next/link";
import { asc, desc, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, modelRegistry, reports, sites } from "@/db/schema";
import Heatmap from "@/components/Heatmap";
import IndiaSpots from "@/components/IndiaSpots";
import PortfolioOverview from "@/components/charts/PortfolioOverview";
import { fmtNum } from "@/lib/ui";
import type { RuleTag } from "@/lib/api";
import {
  barrierFailures,
  kpiStrip,
  modelReview,
  parseFilter,
  ruleDensity,
  siteRuleHeatmap,
  tierMix,
  weeklyTrend,
} from "@/db/queries/overview";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default function Home({ searchParams }: { searchParams?: SearchParams }) {
  const db = getDb();
  const now = Date.now();
  const siteRows = db.select().from(sites).orderBy(desc(sites.density)).all();
  const siteNames = siteRows.map((s) => s.name);
  const filter = parseFilter(searchParams ?? {}, siteNames);
  const [tot] = db
    .select({
      reports: sql<number>`count(*)`,
      sif: sql<number>`sum(case when ${reports.tier} in ('psif','asif') then 1 else 0 end)`,
      review: sql<number>`sum(${reports.needsReview})`,
    })
    .from(reports)
    .all();
  const [corr] = db.select({ n: sql<number>`count(*)` }).from(corrections).all();
  const [model] = db
    .select({ version: modelRegistry.version })
    .from(modelRegistry)
    .where(sql`${modelRegistry.promotedAt} is not null`)
    .orderBy(desc(modelRegistry.registeredAt))
    .all()
    .slice(0, 1);

  const density = tot.reports ? (tot.sif / tot.reports) * 100 : 0;
  const rising = siteRows.filter((s) => s.trend === "rising").length;

  // Most frequent IOGP rule tags per site — presentation only, straight from
  // the classifier's stored rule_tags; sites with no fired packs get no pills.
  const topRulesBySite = new Map<string, string[]>();
  {
    const counts = new Map<string, Map<string, number>>();
    for (const r of db.select({ site: reports.site, ruleTags: reports.ruleTags }).from(reports).all()) {
      let tags: RuleTag[];
      try {
        tags = JSON.parse(r.ruleTags) as RuleTag[];
      } catch {
        continue;
      }
      let m = counts.get(r.site);
      if (!m) counts.set(r.site, (m = new Map()));
      for (const t of tags) m.set(t.rule, (m.get(t.rule) ?? 0) + 1);
    }
    for (const [site, m] of counts) {
      topRulesBySite.set(
        site,
        [...m.entries()]
          .filter(([, n]) => n >= 3)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([rule]) => rule)
      );
    }
  }

  // Age of the oldest unreviewed report, by event date (createdAt is backfilled
  // at seed time and would all be identical).
  const [oldestPending] = db
    .select({ occurredAt: reports.occurredAt })
    .from(reports)
    .where(sql`${reports.needsReview} = 1 and ${reports.occurredAt} is not null`)
    .orderBy(asc(reports.occurredAt))
    .limit(1)
    .all();
  const oldestDays = (() => {
    if (!oldestPending?.occurredAt) return null;
    const t = Date.parse(oldestPending.occurredAt);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  })();

  const kpis = [
    { label: "Reports analysed", value: fmtNum(tot.reports) as string, sub: "seeded demo corpus", href: "/feed" as string | null },
    {
      label: "SIF-potential",
      value: fmtNum(tot.sif),
      sub: `${density.toFixed(1)} per 100 reports`,
      color: "var(--tier-psif)",
      href: "/feed?tier=psif",
    },
    {
      label: "Sites monitored",
      value: fmtNum(siteRows.length),
      sub: rising ? `${rising} flagged rising` : "none rising",
      href: null,
    },
    {
      label: "Awaiting review",
      value: fmtNum(tot.review),
      sub: `${corr.n} resolved`,
      color: "var(--tier-rec)",
      href: "/queue",
    },
    {
      label: "Champion",
      value: model?.version ?? "—",
      sub: "registry",
      href: "/model",
    },
  ];

  // Portfolio-overview charts — one query per chart, all reading the same
  // filtered window (site + weeks from the URL, parsed above).
  const overview = {
    kpi: kpiStrip(filter, now),
    tier: tierMix(filter, now),
    trend: weeklyTrend(filter, now),
    rules: ruleDensity(filter, now),
    barriers: barrierFailures(filter, now),
    heat: siteRuleHeatmap(filter, now),
    review: modelReview(),
  };

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <div>
            <p className="label-micro" style={{ color: "var(--brand)" }}>
              Oil India · HSSE operations
            </p>
            <h1 className="page-title mt-1.5">
              Site risk <em>heatmap</em>
            </h1>
            <p className="mt-2 max-w-[62ch] text-[15px] leading-[1.6] text-[var(--dim)]">
              SIF-potential density per site — the share of classified reports carrying
              serious-injury-and-fatality precursors.
            </p>
          </div>
          <div className="mt-auto flex items-center gap-3 pt-4">
            <span className="flex items-center gap-2 rounded-[3px] border border-[var(--line)] bg-[var(--ink-900)] px-3 py-1.5 text-xs text-[var(--dim)]">
              <span className="dot-live h-1.5 w-1.5 rounded-full" style={{ background: "var(--tier-nm)" }} aria-hidden />
              live classification · <span className="num">{model?.version ?? "—"}</span>
            </span>
            <Link href="/model" className="btn-ghost">
              Learning status
            </Link>
          </div>
        </div>
        {/* Demo anchor: static India silhouette with a dot per monitored
            site — presentation only, no map library. */}
        <IndiaSpots sites={siteRows} />
      </header>

      {/* KPI strip — deliberately flat: no card, no shadow, just a rule on top
          of the page ground. Cards are reserved for the ranked list below. */}
      <section className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5" aria-label="Key numbers">
        {kpis.map((k) => (
          <div key={k.label} className="border-t-2 pt-2.5" style={{ borderColor: k.color ?? "var(--line-strong)" }}>
            <p className="label-micro">{k.label}</p>
            <p
              className="num mt-1 text-[28px] font-semibold leading-none"
              style={k.color ? { color: k.color } : undefined}
            >
              {k.href ? (
                <Link href={k.href} className="hover:underline">
                  {k.value}
                </Link>
              ) : (
                k.value
              )}
            </p>
            {k.sub && <p className="mt-1.5 text-xs text-[var(--faint)]">{k.sub}</p>}
          </div>
        ))}
      </section>

      <section
        aria-label="Review queue status"
        className="mt-7 rounded-[3px] border px-4 py-3"
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 45%, var(--line))",
          background: "color-mix(in srgb, var(--accent) 8%, var(--ink-900))",
        }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
          <h2 className="label-micro" style={{ color: "var(--risk-amber-ink)" }}>
            Needs attention
          </h2>
          <Link href="/queue" className="btn-ghost ml-auto">
            Open review queue
          </Link>
        </div>
        <ul className="mt-2 grid gap-x-8 gap-y-1 text-sm text-[var(--dim)] sm:grid-cols-2">
          <li className="max-w-[70ch]">
            <span className="num font-semibold text-[var(--chalk)]">{fmtNum(tot.review)}</span> reports
            awaiting review
            {oldestDays !== null && (
              <>
                {" — oldest pending event "}
                <span className="num">{oldestDays}</span> days ago
              </>
            )}
          </li>
          <li className="max-w-[70ch]">
            <span className="num font-semibold text-[var(--chalk)]">{fmtNum(corr.n)}</span> reviewer
            decisions logged — each one is fuel for the next model refresh
          </li>
        </ul>
      </section>

      <Heatmap
        sites={siteRows.map((s) => ({ ...s, topRules: topRulesBySite.get(s.name) }))}
        baseline={density}
      />

      <PortfolioOverview filter={filter} siteNames={siteNames} {...overview} />

      <p className="mt-6 max-w-[58ch] border-t border-[var(--line)] pt-3 text-xs leading-5 text-[var(--faint)]">
        Density = (psif + asif) ÷ total reports × 100. Trend compares the last 90 days
        against the prior 90; a swing beyond ±5 points flags rising or falling. The tick on
        each bar marks the system-wide average.
      </p>
    </div>
  );
}
