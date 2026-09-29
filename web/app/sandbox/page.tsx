"use client";

/* Screen 2 — live sandbox: paste a free-text HSSE report, get the full
 * verdict (tier ladder, severity index, rule trace with highlighted
 * triggers, extracted precursors, nearest past incidents). Every run is
 * persisted — the feed grows with each analysis. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ClassifyResult } from "@/lib/api";
import TierChip from "@/components/TierChip";
import SeverityBar, { ProbLadder } from "@/components/Gauges";
import RuleTrace from "@/components/RuleTrace";
import PrecursorPanel from "@/components/PrecursorPanel";

type Similar = {
  id: string;
  excerpt: string;
  tier: string;
  severity_index: number;
  site: string;
  occurred_at: string | null;
  similarity: number;
};

const SAMPLE =
  "During line-breaking work on the 6-inch crude transfer line at the Digboi processing unit, the fitter opened the flange before a pressure test had been recorded. Residual product sprayed onto his forearm. The PTW had been issued for the previous shift and was not re-validated. No barricades were in place below the work platform, and the worker was not wearing chemical-resistant gloves. He was taken to the site clinic for observation.";

export default function Sandbox() {
  const [text, setText] = useState("");
  const [site, setSite] = useState("");
  const [activity, setActivity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ report_id: string; result: ClassifyResult; similar: Similar[] } | null>(null);
  const [sites, setSites] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/sites/heatmap")
      .then((r) => r.json())
      .then((j) => setSites((j.sites ?? []).map((s: { name: string }) => s.name)))
      .catch(() => undefined);
  }, []);

  const canRun = text.trim().length >= 10 && !busy;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          site: site || undefined,
          activity: activity || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `analyze -> ${res.status}`);
      setResult({ report_id: j.report_id, result: j.result, similar: j.similar_reports ?? [] });
      window.dispatchEvent(new Event("anvaya:queue"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  return (
    <div>
      <header>
        <h1 className="page-title">
          Analyze a <em>report</em>
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-[1.6] text-[var(--dim)]">
          Paste any free-text incident narrative. The champion model scores it live, and the
          result is stored in the feed for audit.
        </p>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="panel p-4" aria-label="Report input">
            <div className="flex items-center justify-between">
              <label htmlFor="report-text" className="label-micro">
                Incident narrative
              </label>
              <span className="num text-xs text-[var(--faint)]">{words} words</span>
            </div>
            <textarea
              id="report-text"
              className="field mt-2 min-h-44 resize-y leading-6"
              placeholder="e.g. During hot work on the tank farm, sparks fell onto an uncovered oil-soaked rag…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="field !w-44 py-1.5 text-xs"
                placeholder="site (optional)"
                list="site-list"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                aria-label="Site"
              />
              <datalist id="site-list">
                {sites.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <input
                className="field !w-44 py-1.5 text-xs"
                placeholder="activity (optional)"
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                aria-label="Activity"
              />
              <button type="button" className="btn !py-1.5 text-xs" onClick={() => setText(SAMPLE)}>
                load sample
              </button>
              <button type="button" className="btn-primary ml-auto" onClick={run} disabled={!canRun}>
                {busy ? (
                  <>
                    <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--on-accent)]" aria-hidden />
                    classifying…
                  </>
                ) : (
                  "Analyze report"
                )}
              </button>
            </div>
            {text.trim().length > 0 && text.trim().length < 10 && (
              <p className="mt-2 text-xs text-[var(--tier-rec)]">A few more words — the model needs at least 10 characters.</p>
            )}
          </section>

          {error && (
            <section className="panel border-[var(--tier-asif)] p-4 text-sm" role="alert">
              <p className="font-semibold text-[var(--tier-asif)]">Analysis failed</p>
              <p className="mt-1 text-[var(--dim)]">{error}</p>
              <p className="mt-2 text-xs text-[var(--faint)]">
                The ML service must be running (uvicorn api.main:app on :8000). Start it and retry —
                nothing was persisted.
              </p>
            </section>
          )}

          {result && (
            <section className="panel p-5" aria-label="Verdict">
              <div className="flex flex-wrap items-center gap-3">
                <TierChip tier={result.result.tier} size="md" />
                <SeverityBar value={result.result.severity_index} tier={result.result.tier} width={140} />
                <span className="num text-xs text-[var(--faint)]">
                  confidence {(result.result.confidence * 100).toFixed(1)}% · {result.result.model_version}
                  {result.result.mode === "rules_only" ? " · rules-only mode" : ""}
                </span>
                {result.result.needs_review && (
                  <span
                    className="rounded-[2px] px-1.5 py-0.5 text-xs font-semibold"
                    style={{ color: "var(--tier-rec)", background: "color-mix(in srgb, var(--tier-rec) 12%, transparent)" }}
                  >
                    queued for review
                  </span>
                )}
                <Link href={`/report/${result.report_id}`} className="btn-ghost ml-auto">
                  Open saved report
                </Link>
              </div>

              <div className="mt-4">
                <p className="label-micro">Rule trace — matched trigger phrases highlighted</p>
                <div className="mt-2">
                  <RuleTrace text={text.trim()} tags={result.result.rule_tags} />
                </div>
              </div>

              {result.result.rule_tags.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {result.result.rule_tags.map((t) => (
                    <li key={t.rule} className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--ink-850)] px-2 py-1 text-xs" title={t.matched_phrases.join(" · ")}>
                      <span className="font-medium text-[var(--chalk)]">{t.rule}</span>{" "}
                      <span className="num text-[var(--faint)]">{(t.confidence * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {result ? (
            <>
              <section className="panel p-4" aria-label="Tier probabilities">
                <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
                  Tier probabilities
                </h2>
                <div className="mt-3">
                  <ProbLadder probs={result.result.tiers} />
                </div>
                {result.result.acquisition_score !== null && (
                  <p className="num mt-3 text-xs text-[var(--faint)]">
                    acquisition score {result.result.acquisition_score.toFixed(3)} — how much a human
                    label on this row would teach the next model
                  </p>
                )}
              </section>
              <PrecursorPanel precursors={result.result.precursors} />
              <section className="panel p-4" aria-label="Similar past incidents">
                <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
                  Similar past incidents
                </h2>
                <ul className="mt-3 space-y-3">
                  {result.similar.map((s) => (
                    <li key={s.id} className="text-xs">
                      <Link href={`/report/${s.id}`} className="group">
                        <div className="flex items-center gap-2">
                          <TierChip tier={s.tier} />
                          <span className="num text-xs text-[var(--faint)]">
                            {(s.similarity * 100).toFixed(0)}% match
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 leading-5 text-[var(--dim)] group-hover:text-[var(--chalk)]">
                          {s.excerpt}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--faint)]">
                          {s.site} · {s.occurred_at ?? "date unknown"}
                        </p>
                      </Link>
                    </li>
                  ))}
                  {!result.similar.length && (
                    <li className="text-xs text-[var(--faint)]">No stored reports to compare against yet.</li>
                  )}
                </ul>
              </section>
            </>
          ) : (
            <section className="panel p-4 text-sm text-[var(--faint)]">
              <p className="label-micro">What you will get</p>
              <ul className="mt-2 space-y-2 leading-6">
                <li>ASTM E2920 tier + probability ladder</li>
                <li>Severity index (25–100) sub-rank</li>
                <li>IOGP 459 rule trace with highlighted triggers</li>
                <li>Extracted precursors: energy sources, barrier failures</li>
                <li>Nearest historical incidents by embedding similarity</li>
              </ul>
              <p className="mt-4 leading-5">
                Try <button type="button" className="text-[var(--tier-nm)] underline decoration-dotted" onClick={() => setText(SAMPLE)}>load sample</button> to see a
                line-break spill with a stale permit-to-work.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
