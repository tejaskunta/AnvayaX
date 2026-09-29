/* Shared chrome for every Portfolio-overview chart: the question as the
 * title, the computed takeaway line under it, and the two mandatory states
 * (empty window, small sample). Cards are panels per the layout doctrine;
 * the chart body is provided by each chart component. */
import type { ReactNode } from "react";

type Props = {
  /** The question the chart answers, e.g. "Where is SIF pressure trending?" */
  question: string;
  /** One computed sentence, derived from the data — never hardcoded. */
  takeaway: string;
  children: ReactNode;
  /** Total reports behind the chart; < 20 → small-sample warning + counts. */
  n: number;
  /** Render the warning treatment on the takeaway (escalation, decline). */
  tone?: "neutral" | "warn";
  /** Optional link on the header row (e.g. "Open feed"). */
  action?: ReactNode;
  className?: string;
};

export default function ChartCard({ question, takeaway, children, n, tone = "neutral", action, className = "" }: Props) {
  const empty = n === 0;
  const small = n > 0 && n < 20;
  return (
    <section
      className={`panel flex min-w-0 flex-col p-4 ${className}`}
      aria-label={question}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug text-[var(--chalk)]">{question}</h3>
        {action}
      </div>
      <p
        className="mt-1 max-w-[58ch] text-xs leading-5"
        style={{ color: tone === "warn" ? "var(--risk-amber-ink)" : "var(--faint)" }}
      >
        {takeaway}
      </p>
      {small && (
        <p className="mt-2 rounded-[2px] border px-2 py-1 text-xs" style={{ borderColor: "color-mix(in srgb, var(--caution) 50%, var(--line))", color: "var(--risk-amber-ink)", background: "color-mix(in srgb, var(--caution) 8%, transparent)" }} role="status">
          Small sample (n&nbsp;=&nbsp;{n}) — showing counts, not percentages.
        </p>
      )}
      {empty ? (
        <div className="mt-3 flex flex-1 items-center justify-center border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--faint)]">
          No reports match the current filters.
        </div>
      ) : (
        <div className="mt-3 flex-1">{children}</div>
      )}
    </section>
  );
}
