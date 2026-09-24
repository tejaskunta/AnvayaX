import type { Precursors } from "@/lib/api";

const GROUPS: { key: keyof Precursors; label: string; color: string }[] = [
  { key: "energy_sources", label: "Energy sources", color: "var(--tier-asif)" },
  { key: "barrier_failures", label: "Barrier failures", color: "var(--tier-psif)" },
  { key: "activities", label: "Activities", color: "var(--tier-nm)" },
  { key: "locations", label: "Locations", color: "var(--dim)" },
];

/** Extracted SIF precursor signals (ASTM E2920 lenses) from the ML service. */
export default function PrecursorPanel({ precursors }: { precursors: Partial<Precursors> }) {
  const any = GROUPS.some((g) => (precursors?.[g.key] ?? []).length > 0);
  return (
    <section className="panel p-4" aria-label="SIF precursors">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
        SIF precursors
      </h2>
      {any ? (
        <dl className="mt-3 space-y-3">
          {GROUPS.map((g) => {
            const items = precursors?.[g.key] ?? [];
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <dt className="text-[10px] uppercase tracking-wide" style={{ color: g.color }}>
                  {g.label}
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {items.map((v) => (
                    <span
                      key={v}
                      className="rounded-[2px] border px-1.5 py-0.5 text-[11px] text-[var(--chalk)]"
                      style={{ borderColor: `color-mix(in srgb, ${g.color} 40%, transparent)` }}
                    >
                      {v}
                    </span>
                  ))}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-[var(--faint)]">
          No precursor signals extracted — nothing matches the energy-source or barrier lexicon.
        </p>
      )}
    </section>
  );
}
