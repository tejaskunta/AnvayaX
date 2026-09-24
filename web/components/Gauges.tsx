import { fmtPct, TIER_LABEL, tierChipStyle } from "@/lib/ui";
import TierChip from "@/components/TierChip";

/** 25–100 ordinal severity sub-rank as a compact bar. */
export default function SeverityBar({
  value,
  tier,
  width = 96,
}: {
  value: number;
  tier?: string;
  width?: number;
}) {
  const pct = Math.max(0, Math.min(1, (value - 25) / 75));
  return (
    <div className="flex items-center gap-2" title={`severity_index ${value.toFixed(1)} (${TIER_LABEL[tier ?? ""] ?? tier ?? "n/a"})`}>
      <div
        className="h-1.5 rounded-full bg-[var(--ink-800)] overflow-hidden"
        style={{ width }}
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={25}
        aria-valuemax={100}
        aria-label="Severity index"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct * 100}%`,
            background:
              "linear-gradient(90deg, var(--tier-nm), var(--tier-rec) 45%, var(--tier-psif) 72%, var(--tier-asif))",
          }}
        />
      </div>
      <span className="num text-xs text-[var(--dim)] w-8 text-right">{value.toFixed(0)}</span>
    </div>
  );
}

/** Horizontal probability ladder across the 4 tiers. */
export function ProbLadder({ probs }: { probs: Record<string, number> }) {
  const order = ["near_miss", "recordable", "psif", "asif"];
  return (
    <div className="space-y-1">
      {order.map((t) => {
        const p = probs?.[t] ?? 0;
        return (
          <div key={t} className="flex items-center gap-2">
            <span className="w-20 text-[10px] uppercase tracking-wide text-[var(--faint)]">
              {TIER_LABEL[t]}
            </span>
            <div className="h-1 flex-1 rounded-full bg-[var(--ink-800)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(p * 100, 1.5)}%`, background: tierChipStyle(t).color }}
              />
            </div>
            <span className="num w-12 text-right text-[11px] text-[var(--dim)]">{fmtPct(p, 0)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TierLegend() {
  const order = ["near_miss", "recordable", "psif", "asif"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {order.map((t) => (
        <span key={t} className="flex items-center gap-1.5 text-[11px] text-[var(--dim)]">
          <TierChip tier={t} />
        </span>
      ))}
    </div>
  );
}
