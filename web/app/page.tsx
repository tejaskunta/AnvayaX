import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, modelRegistry, reports, sites } from "@/db/schema";
import Heatmap from "@/components/Heatmap";
import { fmtNum } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const siteRows = db.select().from(sites).orderBy(desc(sites.density)).all();
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

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Site risk heatmap</h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            SIF-potential density per site — the share of classified reports carrying
            serious-injury-and-fatality precursors.
          </p>
        </div>
        <Link href="/model" className="btn-ghost">
          continual-learning status →
        </Link>
      </header>

      <section
        className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3 lg:grid-cols-5"
        aria-label="Key numbers"
      >
        {kpis.map((k) => (
          <div key={k.label} className="bg-[var(--ink-900)] px-4 py-3">
            <p className="label-micro">{k.label}</p>
            <p
              className="num mt-1 text-2xl font-semibold"
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
            {k.sub && <p className="mt-0.5 text-[11px] text-[var(--faint)]">{k.sub}</p>}
          </div>
        ))}
      </section>

      <Heatmap sites={siteRows.map((s) => ({ ...s }))} />

      <p className="mt-4 text-[11px] leading-4 text-[var(--faint)]">
        Density = (psif + asif) ÷ total reports × 100. Trend compares the last 90 days
        against the prior 90; a swing beyond ±5 points flags rising or falling.
      </p>
    </div>
  );
}
