/* Screen 7 — Model Insight. The continual-learning loop made auditable:
 * champion metrics (frozen 52-row regression set), the registry trajectory
 * v1→v2→…, pool state, inter-rater reliability, and data provenance.
 * Server component: reads the sqlite mirror + provenance files directly. */
import fs from "node:fs";
import path from "node:path";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, modelRegistry, reports } from "@/db/schema";
import { ML_ROOT, TIER_ORDER } from "@/lib/aggregates";
import { mlApi } from "@/lib/api";
import { TIER_LABEL, fmtPct, fmtNum } from "@/lib/ui";
import TierChip from "@/components/TierChip";
import RefreshButton from "@/components/RefreshButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegistryRow = typeof modelRegistry.$inferSelect;

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

type SifBlock = {
  precision: number;
  recall: number;
  f2: number;
  average_precision: number;
  positive_support: number;
  recall_prob_mass?: number;
};

type Metrics = {
  n: number;
  accuracy: number;
  macro_f1: number;
  per_class: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  sif_positive: SifBlock;
  threshold_sweep?: { threshold: number; coverage: number; sif_recall_auto: number }[];
};

export default async function ModelInsight() {
  const db = getDb();
  const registry = db.select().from(modelRegistry).orderBy(desc(modelRegistry.registeredAt)).all();
  const champion = registry.find((r) => r.promotedAt !== null) ?? registry[0] ?? null;

  const [pool] = db
    .select({
      total: sql<number>`count(*)`,
      sif: sql<number>`sum(case when ${reports.tier} in ('psif','asif') then 1 else 0 end)`,
      review: sql<number>`sum(${reports.needsReview})`,
    })
    .from(reports)
    .all();
  const [corr] = db
    .select({
      n: sql<number>`count(*)`,
      accepts: sql<number>`sum(case when ${corrections.action} = 'accept' then 1 else 0 end)`,
      corrects: sql<number>`sum(case when ${corrections.action} = 'correct' then 1 else 0 end)`,
      released: sql<number>`sum(${corrections.releasedToPool})`,
    })
    .from(corrections)
    .all();

  // Corrections since the champion's promotion = fuel for the next refresh.
  const sinceQ = champion?.promotedAt
    ? db
        .select({ n: sql<number>`count(*)` })
        .from(corrections)
        .where(and(gte(corrections.createdAt, champion.promotedAt), eq(corrections.releasedToPool, 0)))
        .all()
    : db.select({ n: sql<number>`count(*)` }).from(corrections).where(eq(corrections.releasedToPool, 0)).all();
  const newCorrections = sinceQ[0]?.n ?? 0;

  let service: Awaited<ReturnType<typeof mlApi.modelInfo>> | null = null;
  try {
    service = await mlApi.modelInfo();
  } catch {
    /* offline — mirror renders the story regardless */
  }

  const kappa = readJson<{ kappa: number; observed_agreement: number; n: number; disagreements: number }>(
    path.join(ML_ROOT, "labeling", "kappa.json")
  );
  const prov = readJson<{
    provider: string;
    model: string;
    annotator_model: string;
    prompt_hash: string;
    counts: Record<string, number>;
    sif_potential_share: number;
    note: string;
  }>(path.join(ML_ROOT, "data", "PROVENANCE.json"));

  const metrics: Metrics | null = champion?.metrics ? JSON.parse(champion.metrics) : null;
  const intervalDays = service?.refresh_interval_days ?? 7;
  const gateTol = service?.gate_recall_tolerance_pp ?? 2;

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Model insight</h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--dim)]">
            Every version the loop has produced, the frozen gate that keeps it honest, and the
            provenance of the data it learned from.
          </p>
        </div>
        <RefreshButton running={false} />
      </header>

      {/* Champion banner */}
      <section className="panel mt-5 p-5" aria-label="Active champion">
        <div className="flex flex-wrap items-center gap-3">
          <span className="dot-live h-2 w-2 rounded-full bg-[var(--caution)]" aria-hidden />
          <h2 className="font-display text-lg font-bold">
            {champion?.version ?? "v1"} <span className="text-sm font-medium text-[var(--dim)]">active champion</span>
          </h2>
          <span className="num ml-auto text-xs text-[var(--faint)]">
            {service ? `trained on ${fmtNum(service.registry[0]?.trained_on_rows ?? champion?.trainedOnRows ?? 0)} gold rows` : ""}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {metrics && (
            <>
              <Stat label={`SIF-potential recall`} value={fmtPct(metrics.sif_positive.recall, 1)} color="var(--tier-psif)" sub={`frozen set, n=${metrics.n}`} />
              <Stat label="F2 (recall-weighted)" value={metrics.sif_positive.f2.toFixed(3)} sub="missed SIFs cost more" />
              <Stat label="Macro F1" value={metrics.macro_f1.toFixed(3)} sub={`accuracy ${fmtPct(metrics.accuracy, 1)}`} />
              <Stat label="AP (SIF)" value={metrics.sif_positive.average_precision.toFixed(3)} sub={`support ${metrics.sif_positive.positive_support} / ${metrics.n}`} />
            </>
          )}
        </div>
        {metrics?.threshold_sweep && (
          <p className="mt-3 text-[11px] leading-4 text-[var(--faint)]">
            Review threshold {service?.review_threshold?.toFixed(2) ?? "0.55"}: a report whose top tier is below
            {" "}confidence {service?.review_threshold?.toFixed(2) ?? "0.55"} — or whose SIF-mass probability is near the
            decision boundary — is routed to the review queue. Sweep:{" "}
            {metrics.threshold_sweep
              .filter((_, i) => i % 4 === 0)
              .map((s) => `p≥${s.threshold.toFixed(2)} → ${fmtPct(s.sif_recall_auto, 0)} recall @ ${fmtPct(s.coverage, 0)} auto-accepted`)
              .join(" · ")}
            . Threshold chosen at the knee: high auto-recall while a healthy slice of rows still routes to human review.
          </p>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {/* Trajectory */}
        <section className="panel p-5" aria-label="Model registry trajectory">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
            The loop, versioned
          </h2>
          <p className="mt-1 text-xs text-[var(--faint)]">
            SIF-potential recall on the frozen 52-row regression set. Each refresh trains a LoRA
            challenger on the gold pool; the gate promotes it only if recall doesn&apos;t regress by
            more than {gateTol}pp.
          </p>
          <Trajectory rows={registry} />
          <ul className="mt-4 space-y-2">
            {registry.map((r) => (
              <li key={r.version} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="num font-semibold text-[var(--chalk)]">{r.version}</span>
                  <GateBadge result={r.gateResult} />
                  {r.promotedAt && (
                    <span className="text-[10px] text-[var(--caution)]">promoted</span>
                  )}
                  <span className="num ml-auto text-[10px] text-[var(--faint)]">
                    {r.sifRecall !== null ? `recall ${fmtPct(r.sifRecall, 1)}` : "—"} · {fmtNum(r.trainedOnRows ?? 0)} rows
                  </span>
                </div>
                {r.note && <p className="mt-0.5 text-[11px] leading-4 text-[var(--faint)]">{r.note}</p>}
              </li>
            ))}
          </ul>
        </section>

        {/* Per-class + confusion */}
        <section className="panel p-5" aria-label="Per-class metrics">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
            Where the model errs
          </h2>
          <p className="mt-1 text-xs text-[var(--faint)]">
            Per-class precision / recall / F1 on the frozen regression set. SIF-potential
            (psif + asif) is the headline the gate protects.
          </p>
          {metrics && (
            <table className="mt-4 w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--faint)]">
                  <th className="pb-2">Tier</th>
                  <th className="pb-2 text-right">P</th>
                  <th className="pb-2 text-right">R</th>
                  <th className="pb-2 text-right">F1</th>
                  <th className="pb-2 text-right">n</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.map((t) => {
                  const m = metrics.per_class[t];
                  if (!m) return null;
                  return (
                    <tr key={t} className="border-b border-[var(--line)]/60">
                      <td className="py-2">
                        <TierChip tier={t} size="sm" />
                      </td>
                      <td className="num py-2 text-right">{m.precision.toFixed(2)}</td>
                      <td className="num py-2 text-right">{m.recall.toFixed(2)}</td>
                      <td className="num py-2 text-right">{m.f1.toFixed(2)}</td>
                      <td className="num py-2 text-right text-[var(--faint)]">{m.support}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="py-2 font-semibold text-[var(--chalk)]">SIF-potential</td>
                  <td className="num py-2 text-right">{metrics.sif_positive.precision.toFixed(2)}</td>
                  <td className="num py-2 text-right font-semibold" style={{ color: "var(--tier-psif)" }}>
                    {metrics.sif_positive.recall.toFixed(2)}
                  </td>
                  <td className="num py-2 text-right">f2 {metrics.sif_positive.f2.toFixed(2)}</td>
                  <td className="num py-2 text-right text-[var(--faint)]">{metrics.sif_positive.positive_support}</td>
                </tr>
              </tbody>
            </table>
          )}
          {metrics?.per_class && (
            <p className="mt-4 rounded-[3px] border border-[var(--line)] bg-[var(--ink-850)] p-3 text-[11px] leading-5 text-[var(--dim)]">
              <span className="font-semibold text-[var(--chalk)]">Honest read:</span> asif is rare
              ({metrics.per_class["asif"]?.support ?? 0} rows in the frozen set) and its precision is
              low — the model over-flags catastrophic labels rather than missing them, which is the
              error direction a safety system should bias toward. Recall-probability-mass on SIF
              positives is {metrics.sif_positive.recall_prob_mass?.toFixed(3) ?? "—"}.
            </p>
          )}
        </section>

        {/* Loop state */}
        <section className="panel p-5" aria-label="Loop state">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
            Loop state
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Stat label="Reports in pool" value={fmtNum(pool.total)} sub={`${fmtNum(pool.sif)} SIF-potential (${fmtPct(pool.total ? pool.sif / pool.total : 0, 1)})`} />
            <Stat label="Awaiting review" value={fmtNum(pool.review)} color="var(--tier-rec)" sub="queued by confidence + novelty" />
            <Stat label="Human decisions logged" value={fmtNum(corr.n)} sub={`${fmtNum(corr.accepts)} accepted · ${fmtNum(corr.corrects)} corrected`} />
            <Stat
              label="Corrections since last refresh"
              value={fmtNum(newCorrections)}
              color={newCorrections > 0 ? "var(--caution)" : undefined}
              sub={newCorrections > 0 ? "fuel for the next challenger" : "pool is exhausted until more reviews"}
            />
            <Stat label="Released to training pool" value={fmtNum(corr.released)} sub="corrections the next refresh will see" />
            <Stat label="Refresh cadence" value={`every ${intervalDays} days`} sub="cron + manual trigger" />
          </div>
          <p className="mt-4 text-[11px] leading-5 text-[var(--faint)]">
            The refresh trains <em className="not-italic text-[var(--dim)]">replay-from-base</em>: the
            LoRA adapter is re-trained from the frozen DistilBERT base on the full gold pool
            (synthetic corpus + released human corrections), never incrementally on top of the old
            adapter — that is what prevents catastrophic forgetting between versions.
          </p>
        </section>

        {/* Provenance + reliability */}
        <section className="panel p-5" aria-label="Data provenance">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
            Training-data provenance
          </h2>
          {prov && (
            <div className="mt-3 space-y-3 text-xs leading-5 text-[var(--dim)]">
              <p>
                L3 gold corpus generated via{" "}
                <span className="num text-[var(--chalk)]">{prov.provider}</span>{" "}
                (<span className="num">{prov.model}</span>), independently re-annotated by{" "}
                <span className="num">{prov.annotator_model}</span> from text alone. Prompt hash{" "}
                <span className="num">{prov.prompt_hash}</span>. {prov.note}
              </p>
              <div className="flex flex-wrap gap-2">
                {TIER_ORDER.map((t) => (
                  <span key={t} className="num rounded-[2px] border border-[var(--line-strong)] bg-[var(--ink-850)] px-2 py-0.5 text-[11px]">
                    {TIER_LABEL[t]} × {prov.counts[t] ?? 0}
                  </span>
                ))}
                <span className="rounded-[2px] border border-[var(--line-strong)] px-2 py-0.5 text-[11px]" style={{ color: "var(--tier-psif)" }}>
                  SIF-potential share {fmtPct(prov.sif_potential_share, 1)}
                </span>
              </div>
            </div>
          )}
          {kappa && (
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <p className="label-micro">Inter-rater reliability</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="num text-3xl font-bold" style={{ color: kappa.kappa >= 0.61 ? "var(--tier-nm)" : "var(--tier-rec)" }}>
                  κ {kappa.kappa.toFixed(3)}
                </span>
                <span className="text-xs text-[var(--dim)]">
                  {kappa.kappa >= 0.81 ? "almost perfect" : kappa.kappa >= 0.61 ? "substantial" : "moderate"} agreement ·{" "}
                  {fmtPct(kappa.observed_agreement, 1)} observed
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-[var(--faint)]">
                Cohen&apos;s κ between the two independent annotator passes on a stratified{" "}
                n={kappa.n} sample. The {kappa.disagreements} disagreements were excluded from the
                training gold — the model is only ever trained on rows humans and the second-pass
                model both accept.
              </p>
            </div>
          )}
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <p className="label-micro">Runtime</p>
            <p className="mt-1 text-xs text-[var(--dim)]">
              {service ? (
                <>
                  base <span className="num">{service.base_model}</span> · LoRA r16/α32 · embeddings{" "}
                  <span className="num">{service.embedding_model}</span> ({service.embedding_dim}-d) ·{" "}
                  {service.mode === "transformer" ? "transformer + rules" : "rules-only fallback"}
                </>
              ) : (
                <span className="text-[var(--tier-rec)]">ML service offline — registry mirror shown; start uvicorn :8000 for live state.</span>
              )}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <p className="label-micro">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] leading-4 text-[var(--faint)]">{sub}</p>}
    </div>
  );
}

function GateBadge({ result }: { result: string }) {
  const map: Record<string, { c: string; t: string }> = {
    promoted: { c: "var(--tier-nm)", t: "gate PASS" },
    initial: { c: "var(--caution)", t: "baseline" },
    rejected: { c: "var(--tier-asif)", t: "gate REJECT" },
    gate_reject: { c: "var(--tier-asif)", t: "gate REJECT" },
    error: { c: "var(--tier-asif)", t: "error" },
    service_offline: { c: "var(--tier-rec)", t: "service offline" },
  };
  const m = map[result] ?? { c: "var(--dim)", t: result };
  return (
    <span
      className="rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: m.c, background: `color-mix(in srgb, ${m.c} 12%, transparent)` }}
    >
      {m.t}
    </span>
  );
}

/** SVG line chart: registry versions in chronological order, recall %. */
function Trajectory({ rows }: { rows: RegistryRow[] }) {
  const chrono = [...rows].reverse(); // registeredAt desc → chronological
  const pts = chrono
    .map((r, i) => ({ x: i, v: r.sifRecall, label: r.version, promoted: r.promotedAt !== null }))
    .filter((p) => p.v !== null) as { x: number; v: number; label: string; promoted: boolean }[];
  if (!pts.length) return <p className="mt-4 text-sm text-[var(--faint)]">No registry data yet.</p>;

  const W = 480;
  const H = 160;
  const PAD = { l: 44, r: 16, t: 12, b: 28 };
  const xs = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(pts.length - 1, 1);
  const yMin = 0.5;
  const ys = (v: number) => PAD.t + (1 - (v - yMin) / (1 - yMin)) * (H - PAD.t - PAD.b);

  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xs(p.x).toFixed(1)},${ys(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${xs(pts[pts.length - 1].x).toFixed(1)},${ys(yMin)} L${xs(pts[0].x).toFixed(1)},${ys(yMin)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="SIF recall by model version">
      <defs>
        <linearGradient id="traj" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tier-psif)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--tier-psif)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.6, 0.7, 0.8, 0.9, 1.0].map((g) => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={ys(g)} y2={ys(g)} stroke="var(--line)" strokeWidth="1" />
          <text x={PAD.l - 6} y={ys(g) + 3} textAnchor="end" fontSize="9" fill="var(--faint)" className="num">
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}
      <path d={area} fill="url(#traj)" />
      <path d={path} fill="none" stroke="var(--tier-psif)" strokeWidth="2" />
      {pts.map((p) => (
        <g key={p.label}>
          <circle cx={xs(p.x)} cy={ys(p.v)} r={p.promoted ? 5 : 4} fill={p.promoted ? "var(--tier-nm)" : "var(--tier-asif)"} stroke="var(--ink-900)" strokeWidth="2" />
          <text x={xs(p.x)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--dim)" className="num">
            {p.label}
          </text>
          <text x={xs(p.x)} y={ys(p.v) - 10} textAnchor="middle" fontSize="10" fill="var(--chalk)" className="num">
            {fmtPct(p.v, 1)}
          </text>
        </g>
      ))}
    </svg>
  );
}
