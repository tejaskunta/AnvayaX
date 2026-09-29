import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { reports, sites } from "@/db/schema";
import TierChip from "@/components/TierChip";
import SeverityBar from "@/components/Gauges";
import MonthlyTrend from "@/components/MonthlyTrend";
import { fmtNum, TIER_LABEL } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function SiteDrilldown({ params }: { params: { name: string } }) {
  const name = decodeURIComponent(params.name);
  const db = getDb();
  const site = db.select().from(sites).where(eq(sites.name, name)).all()[0];
  if (!site) notFound();

  const rs = db
    .select({
      id: reports.id,
      tier: reports.tier,
      activity: reports.activity,
      severityIndex: reports.severityIndex,
      occurredAt: reports.occurredAt,
      confidence: reports.confidence,
      rawText: reports.rawText,
      needsReview: reports.needsReview,
    })
    .from(reports)
    .where(eq(reports.site, name))
    .all();

  const tierMix = { near_miss: 0, recordable: 0, psif: 0, asif: 0 } as Record<string, number>;
  const byMonth = new Map<string, { total: number; sif: number }>();
  const byActivity = new Map<string, { total: number; sif: number }>();
  for (const r of rs) {
    tierMix[r.tier] = (tierMix[r.tier] ?? 0) + 1;
    const isSif = r.tier === "psif" || r.tier === "asif";
    if (r.occurredAt) {
      const m = r.occurredAt.slice(0, 7);
      const v = byMonth.get(m) ?? { total: 0, sif: 0 };
      v.total++;
      v.sif += isSif ? 1 : 0;
      byMonth.set(m, v);
    }
    const act = r.activity || "Unspecified";
    const a = byActivity.get(act) ?? { total: 0, sif: 0 };
    a.total++;
    a.sif += isSif ? 1 : 0;
    byActivity.set(act, a);
  }

  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, total: v.total, sif: v.sif, density: (v.sif / v.total) * 100 }));
  const activities = [...byActivity.entries()]
    .map(([activity, v]) => ({ activity, ...v, density: (v.sif / v.total) * 100 }))
    .sort((a, b) => b.sif - a.sif || b.total - a.total)
    .slice(0, 8);
  const worst = [...rs].sort((a, b) => b.severityIndex - a.severityIndex).slice(0, 6);

  const trend =
    site.trend === "rising"
      ? { glyph: "▲", color: "var(--tier-asif)", label: "Rising" }
      : site.trend === "falling"
        ? { glyph: "▼", color: "var(--tier-nm)", label: "Falling" }
        : { glyph: "—", color: "var(--faint)", label: "Stable" };

  return (
    <div>
      <nav className="text-xs text-[var(--faint)]" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-[var(--dim)]">
          Site risk
        </Link>
        <span aria-hidden> / </span>
        <span className="text-[var(--dim)]">{site.name}</span>
      </nav>

      <header className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{site.name}</h1>
          <p className="mt-2 text-sm text-[var(--dim)]">
            {site.region} · {fmtNum(site.totalReports)} reports · {fmtNum(site.sifPositive)} SIF-potential
          </p>
        </div>
        <div className="panel px-4 py-2 text-right">
          <p className="label-micro">SIF density · 90-day change</p>
          <p className="num mt-0.5 text-xl font-semibold" style={{ color: trend.color }}>
            {site.density.toFixed(1)}
            <span className="mx-2 text-sm" aria-hidden>
              {trend.glyph}
            </span>
            <span className="text-sm">
              {site.deltaDensity > 0 ? "+" : ""}
              {site.deltaDensity.toFixed(1)} pp
            </span>
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="panel min-w-0 p-4" aria-label="Monthly trend">
          <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
            Monthly SIF-potential density
          </h2>
          <MonthlyTrend data={monthly} />
        </section>

        <section className="panel min-w-0 p-4" aria-label="Tier mix">
          <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
            Tier mix
          </h2>
          <ul className="mt-3 space-y-2">
            {(["asif", "psif", "recordable", "near_miss"] as const).map((t) => {
              const n = tierMix[t] ?? 0;
              const pct = rs.length ? (n / rs.length) * 100 : 0;
              return (
                <li key={t} className="flex items-center gap-3">
                  <span className="w-24 shrink-0">
                    <TierChip tier={t} />
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-800)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(pct, n ? 3 : 0)}%`,
                        background: `var(--tier-${t === "near_miss" ? "nm" : t === "recordable" ? "rec" : t})`,
                      }}
                    />
                  </div>
                  <span className="num w-14 text-right text-xs text-[var(--dim)]">
                    {n} · {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-4 text-[var(--faint)]">
            {TIER_LABEL.psif} + {TIER_LABEL.asif} = {site.sifPositive} of {site.totalReports} (
            {site.density.toFixed(1)} per 100).
          </p>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="panel min-w-0 p-4" aria-label="Activities by SIF count">
          <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
            Activities driving risk
          </h2>
          <ul className="mt-3 space-y-2.5">
            {activities.map((a) => (
              <li key={a.activity}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-[var(--chalk)]">{a.activity}</span>
                  <span className="num shrink-0 text-xs text-[var(--dim)]">
                    {a.sif}/{a.total} · {a.density.toFixed(0)}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--ink-800)]">
                  <div
                    className="h-full rounded-full bg-[var(--tier-psif)]"
                    style={{ width: `${Math.min((a.density / 60) * 100, 100)}%` }}
                  />
                </div>
              </li>
            ))}
            {!activities.length && <li className="text-sm text-[var(--faint)]">No activity tags yet.</li>}
          </ul>
        </section>

        <section aria-label="Highest severity reports" className="min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
              Highest severity at this site
            </h2>
            <Link href={`/feed?site=${encodeURIComponent(site.name)}`} className="btn-ghost">
              All site reports
            </Link>
          </div>
          <ul className="panel mt-3 space-y-px overflow-hidden">
            {worst.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <TierChip tier={r.tier} />
                  <span className="num text-xs text-[var(--faint)]">{r.id}</span>
                  <span className="ml-auto">
                    <SeverityBar value={r.severityIndex} tier={r.tier} width={72} />
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 max-w-[58ch] text-[13px] leading-5 text-[var(--dim)]">
                  {r.rawText.slice(0, 220)}
                  {r.rawText.length > 220 ? "…" : ""}
                </p>
                <p className="mt-1 text-xs text-[var(--faint)]">
                  {r.occurredAt ?? "date unknown"}
                  {r.activity ? ` · ${r.activity}` : ""} · confidence {(r.confidence * 100).toFixed(0)}%
                  {r.needsReview ? " · in review queue" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
