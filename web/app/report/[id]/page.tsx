import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, reports } from "@/db/schema";
import TierChip from "@/components/TierChip";
import SeverityBar, { ProbLadder } from "@/components/Gauges";
import RuleTrace from "@/components/RuleTrace";
import PrecursorPanel from "@/components/PrecursorPanel";
import { fmtDate, SOURCE_LABEL, TIER_LABEL } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ReportDetail({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const db = getDb();
  const row = db.select().from(reports).where(eq(reports.id, id)).all()[0];
  if (!row) notFound();
  const correction = db.select().from(corrections).where(eq(corrections.reportId, id)).all()[0] ?? null;

  const tags = JSON.parse(row.ruleTags) as { rule: string; matched_phrases: string[]; confidence: number }[];
  const probs = JSON.parse(row.tierProbs) as Record<string, number>;
  const precursors = JSON.parse(row.precursors) as {
    activities: string[];
    locations: string[];
    barrier_failures: string[];
    energy_sources: string[];
  };

  return (
    <div>
      <nav className="text-xs text-[var(--faint)]" aria-label="Breadcrumb">
        <Link href="/feed" className="hover:text-[var(--dim)]">
          Reports
        </Link>
        <span aria-hidden> / </span>
        <span className="num text-[var(--dim)]">{row.id}</span>
      </nav>

      <header className="mt-2 flex flex-wrap items-center gap-3">
        <TierChip tier={row.tier} size="md" />
        <SeverityBar value={row.severityIndex} tier={row.tier} width={120} />
        <span className="num text-xs text-[var(--faint)]">
          confidence {(row.confidence * 100).toFixed(1)}% · {row.modelVersion}
        </span>
        {row.needsReview === 1 && !correction && (
          <Link href="/queue" className="btn-ghost">
            Review in queue
          </Link>
        )}
        {correction && (
          <span className="rounded-[2px] border border-[var(--tier-nm)] px-2 py-0.5 text-xs" style={{ color: "var(--tier-nm)" }}>
            {correction.action === "accept" ? "reviewer accepted" : `reviewer corrected → ${TIER_LABEL[correction.correctedTag]}`}
            {correction.releasedToPool === 1 ? " · released to pool" : ""}
          </span>
        )}
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <section className="panel p-5" aria-label="Report text">
            <p className="label-micro">
              {row.site} · {row.activity ?? "activity unspecified"} · {fmtDate(row.occurredAt)} ·{" "}
              {SOURCE_LABEL[row.sourceLayer] ?? row.sourceLayer}
              {row.isSynthetic ? " · synthetic" : ""}
            </p>
            <div className="mt-3 max-w-[50ch]">
              <RuleTrace text={row.rawText} tags={tags} />
            </div>
          </section>

          <section className="panel p-5" aria-label="Rule tags">
            <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
              IOGP 459 rule trace
            </h2>
            {tags.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <li
                    key={t.rule}
                    className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--ink-850)] px-2 py-1 text-xs"
                    title={t.matched_phrases.join(" · ")}
                  >
                    <span className="font-medium text-[var(--chalk)]">{t.rule}</span>{" "}
                    <span className="num text-[var(--faint)]">{(t.confidence * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 max-w-[60ch] text-sm text-[var(--faint)]">
                No rule packs fired above the tag threshold — the transformer verdict stands on its own here.
              </p>
            )}
            <p className="mt-3 max-w-[60ch] text-xs text-[var(--faint)]">
              Hover a tag to see the trigger phrases; they are highlighted in the text above.
            </p>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="panel p-4" aria-label="Tier probabilities">
            <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
              Tier probabilities
            </h2>
            <div className="mt-3">
              <ProbLadder probs={probs} />
            </div>
          </section>
          <PrecursorPanel precursors={precursors} />
        </aside>
      </div>
    </div>
  );
}
