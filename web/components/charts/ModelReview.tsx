"use client";

/* Chart 7 — model review panel. One bar per original → corrected tag pair,
 * read from the corrections table (the human verdicts that feed the
 * flywheel). Counts only — the decision population is small by design.
 * Bars link to the feed filtered to the corrected tier. */
import Link from "next/link";

import ChartCard from "@/components/charts/ChartCard";
import { TIER_HEX, TIER_LABEL, fmtNum } from "@/lib/ui";
import type { ModelReviewData } from "@/db/queries/overview";

export default function ModelReview({ data }: { data: ModelReviewData }) {
  const max = Math.max(...data.bars.map((b) => b.n), 1);
  return (
    <ChartCard
      question="Where does the model get it wrong?"
      takeaway={data.takeaway}
      n={data.decisions}
      action={
        <Link href="/queue" className="btn-ghost shrink-0 text-xs">
          Review queue
        </Link>
      }
    >
      {data.bars.length === 0 ? (
        <p className="text-xs text-[var(--faint)]">No reviewer decisions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Reviewer corrections by tag">
          {data.bars.map((b) => {
            const same = b.from === b.to;
            return (
              <li key={`${b.from}-${b.to}`}>
                <Link
                  href={`/feed?tier=${b.to}`}
                  className="group block rounded-[2px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  aria-label={`${TIER_LABEL[b.from]} ${same ? "confirmed as" : "corrected to"} ${TIER_LABEL[b.to]}: ${b.n} decision${b.n === 1 ? "" : "s"}.`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[var(--dim)] group-hover:text-[var(--chalk)]">
                      <span className="num mr-1.5 inline-block h-2 w-2 rounded-full align-baseline" style={{ background: TIER_HEX[b.from] }} aria-hidden />
                      {TIER_LABEL[b.from]}
                      <span className="mx-1.5 text-[var(--faint)]">{same ? "→ confirmed" : "→ corrected to"}</span>
                      <span className="num mr-1.5 inline-block h-2 w-2 rounded-full align-baseline" style={{ background: TIER_HEX[b.to] }} aria-hidden />
                      {TIER_LABEL[b.to]}
                    </span>
                    <span className="num shrink-0 text-[var(--chalk)]">{fmtNum(b.n)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full" style={{ background: `color-mix(in srgb, ${TIER_HEX[b.to]} 12%, #f2f5f8)` }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max((b.n / max) * 100, 3)}%`, background: TIER_HEX[b.to] }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 border-t border-[var(--line)] pt-2 text-xs leading-5 text-[var(--faint)]">
        Recall needs ≥ 30 reviewed reports before it is meaningful — until then the KPI shows a note, never a number.
      </p>
    </ChartCard>
  );
}
