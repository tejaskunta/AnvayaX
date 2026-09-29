"use client";

/* Portfolio-overview filter bar: one site + one date window for every chart.
 * Lives in the URL (?site=&weeks=) so the server components re-query and any
 * filtered view is shareable/bookmarkable. */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const WEEKS = [
  { value: 4, label: "4 weeks" },
  { value: 12, label: "12 weeks" },
  { value: 26, label: "26 weeks" },
] as const;

type Props = {
  sites: string[];
  /** Site names currently carrying data — greyed out when the window is empty. */
  hasData?: boolean;
};

export default function OverviewFilterBar({ sites }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const site = sp.get("site") ?? "";
  const weeks = sp.get("weeks") ?? "4";

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`/?${next.toString()}`, { scroll: false });
    },
    [router, sp]
  );

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[3px] border border-[var(--line)] bg-[var(--ink-900)] px-4 py-2.5" role="group" aria-label="Chart filters">
      <span className="label-micro text-[var(--faint)]">Filters</span>

      <label className="flex items-center gap-2 text-xs text-[var(--dim)]">
        Site
        <select
          value={site}
          onChange={(e) => setParam("site", e.target.value)}
          className="rounded-[3px] border border-[var(--line-strong)] bg-[var(--ink-900)] px-2 py-1 text-xs text-[var(--chalk)] focus:border-[var(--tier-nm)] focus:outline-none"
          aria-label="Filter charts by site"
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Date range">
        {WEEKS.map((w) => {
          const active = weeks === String(w.value);
          return (
            <button
              key={w.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setParam("weeks", String(w.value))}
              className="rounded-[3px] border px-2.5 py-1 text-xs transition-colors"
              style={
                active
                  ? { borderColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 10%, transparent)", color: "var(--chalk)" }
                  : { borderColor: "var(--line)", color: "var(--dim)" }
              }
            >
              {w.label}
            </button>
          );
        })}
      </div>

      {(site || weeks !== "4") && (
        <button
          type="button"
          onClick={() => router.push("/", { scroll: false })}
          className="ml-auto text-xs text-[var(--faint)] underline-offset-2 hover:text-[var(--chalk)] hover:underline"
        >
          Reset
        </button>
      )}
    </div>
  );
}
