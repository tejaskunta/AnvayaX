"use client";

/* Screen 6 — Review Queue. The flywheel intake: rows ordered by acquisition
 * score (predictive entropy + embedding-space novelty). Accept or correct
 * each row; corrections are the training signal for the next refresh. */
import { useCallback, useEffect, useState } from "react";

import type { ClassifyResult, RuleTag } from "@/lib/api";
import TierChip from "@/components/TierChip";
import { ProbLadder } from "@/components/Gauges";
import { TIER_ORDER, TIER_LABEL, fmtPct } from "@/lib/ui";

type QueueRow = {
  id: string;
  excerpt: string;
  tier: string;
  confidence: number;
  severityIndex: number;
  tier_probs: Record<string, number>;
  rule_tags: RuleTag[];
  precursors: ClassifyResult["precursors"];
  site: string;
  activity: string | null;
  occurredAt: string | null;
  sourceLayer: string;
  acquisitionScore: number;
  modelVersion: string;
};

type QueueData = { queue_total: number; resolved_total: number; queue: QueueRow[] };

function priorityReason(row: QueueRow): string {
  if (row.confidence < 0.5) return "low model confidence";
  if (row.acquisitionScore >= 0.6) return "high novelty + uncertainty";
  if (row.acquisitionScore >= 0.45) return "novel embedding pattern";
  return "below confidence threshold";
}

export default function Queue() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [correctedBy, setCorrectedBy] = useState("reviewer");
  const [limit, setLimit] = useState(25);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/queue?limit=${limit}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`queue -> ${r.status}`);
        return r.json();
      })
      .then((j: QueueData) => {
        setData(j);
        setActiveId((cur) => cur ?? j.queue[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  const active = data?.queue.find((r) => r.id === activeId) ?? null;

  const resolve = async (action: "accept" | "correct", correctedTag?: string) => {
    if (!active) return;
    setResolveBusy(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/queue/${encodeURIComponent(active.id)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, corrected_tag: correctedTag, corrected_by: correctedBy }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `resolve -> ${res.status}`);
      // Advance to next unresolved row.
      const remaining = (data?.queue ?? []).filter((r) => r.id !== active.id);
      setActiveId(remaining[0]?.id ?? null);
      load();
      window.dispatchEvent(new Event("anvaya:queue"));
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolveBusy(false);
    }
  };

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Review queue</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--dim)]">
            Rows the model is least sure about, ranked by{" "}
            <em className="not-italic text-[var(--chalk)]">acquisition score</em> — a blend of
            predictive entropy and embedding-space novelty. Each decision here is a labelled
            training example for the next refresh.
          </p>
        </div>
        <div className="text-right text-xs text-[var(--faint)]">
          <p className="num text-xl font-semibold text-[var(--chalk)]">{data?.queue_total ?? "—"}</p>
          <p>still queued</p>
          <p className="num mt-1 text-sm text-[var(--tier-nm)]">{data?.resolved_total ?? 0} resolved</p>
        </div>
      </header>

      {error && (
        <p className="panel mt-4 border-[var(--tier-asif)] p-3 text-sm text-[var(--tier-asif)]">{error}</p>
      )}

      {loading && !data && (
        <p className="mt-8 text-sm text-[var(--faint)]">loading queue…</p>
      )}

      {data && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Queue list */}
          <nav aria-label="Queue items" className="space-y-px overflow-hidden rounded-[3px] border border-[var(--line)]">
            {data.queue.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => { setActiveId(row.id); setResolveError(null); }}
                aria-current={row.id === activeId}
                className={`block w-full px-3 py-2.5 text-left transition-colors ${
                  row.id === activeId
                    ? "bg-[var(--ink-800)]"
                    : "bg-[var(--ink-900)] hover:bg-[var(--ink-850)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="num shrink-0 rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      color: row.acquisitionScore >= 0.6 ? "var(--tier-asif)" : row.acquisitionScore >= 0.45 ? "var(--tier-psif)" : "var(--tier-rec)",
                      background: "color-mix(in srgb, var(--tier-rec) 10%, transparent)",
                    }}
                    title="acquisition score"
                  >
                    {row.acquisitionScore.toFixed(2)}
                  </span>
                  <TierChip tier={row.tier} />
                  <span className="num ml-auto text-[10px] text-[var(--faint)]">{fmtPct(row.confidence, 0)}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--dim)]">{row.excerpt}</p>
                <p className="mt-1 text-[10px] text-[var(--faint)]">{row.site} · {priorityReason(row)}</p>
              </button>
            ))}
            {!data.queue.length && (
              <p className="bg-[var(--ink-900)] px-3 py-8 text-center text-sm text-[var(--faint)]">
                Queue is empty — every low-confidence report has been reviewed.
              </p>
            )}
            {data.queue_total > data.queue.length && (
              <button
                type="button"
                className="block w-full bg-[var(--ink-900)] px-3 py-2 text-center text-xs text-[var(--tier-nm)] hover:bg-[var(--ink-850)]"
                onClick={() => setLimit((l) => l + 25)}
              >
                load more ({data.queue_total - data.queue.length} remaining)
              </button>
            )}
          </nav>

          {/* Active row detail */}
          {active ? (
            <section className="panel p-5" aria-label={`Reviewing ${active.id}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-xs text-[var(--faint)]">{active.id}</span>
                <span className="text-[11px] text-[var(--faint)]">
                  {active.site} · {active.occurredAt ?? "date unknown"} · {active.modelVersion}
                </span>
                <span className="ml-auto text-[11px] text-[var(--faint)]">{priorityReason(active)}</span>
              </div>

              <p className="mt-3 text-sm leading-6 text-[var(--chalk)]">{active.excerpt}</p>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="label-micro">Model verdict</p>
                  <div className="mt-2 flex items-center gap-2">
                    <TierChip tier={active.tier} size="md" />
                    <span className="num text-xs text-[var(--dim)]">
                      severity {active.severityIndex.toFixed(0)} · conf {fmtPct(active.confidence, 0)}
                    </span>
                  </div>
                  <div className="mt-3">
                    <ProbLadder probs={active.tier_probs} />
                  </div>
                </div>
                <div>
                  <p className="label-micro">Rule tags</p>
                  {active.rule_tags.length ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {active.rule_tags.map((t) => (
                        <li key={t.rule} className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--ink-850)] px-1.5 py-0.5 text-[11px]" title={t.matched_phrases.join(" · ")}>
                          <span className="text-[var(--chalk)]">{t.rule}</span>{" "}
                          <span className="num text-[var(--faint)]">{(t.confidence * 100).toFixed(0)}%</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--faint)]">No rule packs fired.</p>
                  )}
                  <p className="label-micro mt-4">Energy sources · barrier failures</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--dim)]">
                    {active.precursors.energy_sources.join(", ") || "—"}
                    {active.precursors.barrier_failures.length ? ` · barriers: ${active.precursors.barrier_failures.join(", ")}` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-6 border-t border-[var(--line)] pt-4">
                {resolveError && (
                  <p className="mb-3 text-sm text-[var(--tier-asif)]" role="alert">{resolveError}</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn text-sm"
                    style={{ borderColor: "var(--tier-nm)", color: "var(--tier-nm)" }}
                    onClick={() => resolve("accept")}
                    disabled={resolveBusy}
                  >
                    ✓ Accept verdict
                  </button>
                  <span className="text-xs text-[var(--faint)]">or correct to:</span>
                  {TIER_ORDER.filter((t) => t !== active.tier).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="btn text-xs"
                      onClick={() => resolve("correct", t)}
                      disabled={resolveBusy}
                      style={{ color: `var(--tier-${t === "near_miss" ? "nm" : t === "recordable" ? "rec" : t})` }}
                    >
                      {TIER_LABEL[t]}
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-2 text-xs text-[var(--faint)]">
                    as
                    <input
                      className="field !w-28 py-1 text-xs"
                      value={correctedBy}
                      onChange={(e) => setCorrectedBy(e.target.value)}
                      aria-label="Reviewer name"
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] leading-4 text-[var(--faint)]">
                  Accept confirms the model label. Correct overrides it and updates the report tier.
                  Both write a row to the corrections table — the training signal the next refresh consumes.
                </p>
              </div>
            </section>
          ) : (
            <section className="panel flex items-center justify-center p-10 text-sm text-[var(--faint)]">
              Select a queue item to review.
            </section>
          )}
        </div>
      )}
    </div>
  );
}
