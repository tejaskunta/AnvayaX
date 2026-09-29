/* Server-only Drizzle queries powering the Portfolio overview charts.
 * One exported function per chart; each comment states WHAT it returns and
 * WHY. Every number is read from the reports table — nothing is hardcoded.
 * Pure math (weeks, rules, escalation) lives in lib/overview.ts so it can be
 * unit-tested without a database. */
import "server-only";

import { and, eq, gte } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, reports } from "@/db/schema";
import {
  ESCALATION_DELTA,
  bucketByWeek,
  densityPer100,
  distinctRules,
  isEscalating,
  parseYmd,
  tallyRules,
  weekStartMonday,
  windowStartMonday,
  type WeekBucket,
} from "@/lib/overview";

export type Weeks = 4 | 12 | 26;
export type OverviewFilter = { site: string | null; weeks: Weeks };

const SIF = new Set(["psif", "asif"]);

/** Extractor artifacts that sit in barrier_failure but are not real barriers
 *  (prose fragments like "failed to engage" → "to"). Excluded from chart 5. */
const BARRIER_JUNK = new Set(["to", "not", "without"]);

/** Below this many reviewed reports, recall is not reported (chart 1). */
export const RECALL_MIN_REVIEWED = 30;

/** Small-sample threshold: show raw counts instead of percentages (all charts). */
export const SMALL_SAMPLE = 20;

type Row = {
  id: string;
  tier: string;
  site: string;
  ruleTags: string;
  activity: string | null;
  barrierFailure: string | null;
  occurredAt: string | null;
};

/** What: every report whose event date falls in [startMonday, ∞), optionally
 *  one site. Why: one narrow SELECT feeds all seven charts; windowing and
 *  bucketing then happen in tested pure functions, not drifting SQL variants. */
function fetchRows(startMonday: string, site: string | null): Row[] {
  const conds = [gte(reports.occurredAt, startMonday)];
  if (site) conds.push(eq(reports.site, site));
  return getDb()
    .select({
      id: reports.id,
      tier: reports.tier,
      site: reports.site,
      ruleTags: reports.ruleTags,
      activity: reports.activity,
      barrierFailure: reports.barrierFailure,
      occurredAt: reports.occurredAt,
    })
    .from(reports)
    .where(and(...conds))
    .all();
}

function windowRows(f: OverviewFilter, nowMs: number): Row[] {
  return fetchRows(windowStartMonday(nowMs, f.weeks), f.site);
}

/* ------------------------------------------------------------------ *
 * Chart 1 — KPI strip.                                                *
 * ------------------------------------------------------------------ */

export type KpiStripData = {
  total: number;
  sifCount: number;
  sifShare: number | null; // 0..1, null when window is empty
  escalatingPairs: number; // site×rule cells breaching ESCALATION_DELTA
  worstPair: string | null; // "Site × Rule" for the biggest breach
  reviewedCount: number;
  recall: number | null; // null → render RECALL_NOTE, never a fake value
  recallNote: string | null;
};

export const RECALL_NOTE = "Not enough reviewed reports";

/** What: reports ingested, SIF share, escalating site×rule pairs, and model
 *  recall on aSIF+pSIF from human decisions only. Why: recall is computed
 *  against corrected tags (the human verdict); with < RECALL_MIN_REVIEWED
 *  reviewed reports it is withheld outright rather than shown as noise. */
export function kpiStrip(f: OverviewFilter, nowMs: number): KpiStripData {
  const rows = windowRows(f, nowMs);
  const sifCount = rows.filter((r) => SIF.has(r.tier)).length;

  const heat = siteRuleHeatmap(f, nowMs);
  const escalating = heat.cells.filter((c) => c.escalating);
  const worst = [...escalating].sort((a, b) => b.recent - b.prior - (a.recent - a.prior))[0];

  const decisions = getDb()
    .select({ orig: corrections.originalTag, corr: corrections.correctedTag })
    .from(corrections)
    .all();
  const reviewedCount = new Set(
    getDb()
      .select({ rid: corrections.reportId })
      .from(corrections)
      .all()
      .map((r) => r.rid)
  ).size;

  let recall: number | null = null;
  if (reviewedCount >= RECALL_MIN_REVIEWED) {
    const trueSif = decisions.filter((d) => SIF.has(d.corr));
    if (trueSif.length > 0) {
      recall = trueSif.filter((d) => SIF.has(d.orig)).length / trueSif.length;
    }
  }

  return {
    total: rows.length,
    sifCount,
    sifShare: rows.length ? sifCount / rows.length : null,
    escalatingPairs: escalating.length,
    worstPair: worst ? `${worst.site} × ${worst.rule}` : null,
    reviewedCount,
    recall,
    recallNote: recall === null ? RECALL_NOTE : null,
  };
}

/* ------------------------------------------------------------------ *
 * Chart 2 — tier mix donut.                                           *
 * ------------------------------------------------------------------ */

export type TierMixData = {
  slices: { tier: string; n: number }[]; // TIER_ORDER, zero counts kept
  total: number;
  takeaway: string;
};

/** What: report count per tier inside the filter window; center label = total.
 *  Why: fixed tier order keeps donut colour/label mapping stable across filters. */
export function tierMix(f: OverviewFilter, nowMs: number): TierMixData {
  const rows = windowRows(f, nowMs);
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.tier, (by.get(r.tier) ?? 0) + 1);
  const slices = ["asif", "psif", "recordable", "near_miss"].map((tier) => ({ tier, n: by.get(tier) ?? 0 }));
  const sif = (by.get("asif") ?? 0) + (by.get("psif") ?? 0);
  const takeaway = rows.length
    ? `${sif} of ${rows.length} reports carry SIF precursors (${((sif / rows.length) * 100).toFixed(0)}%)`
    : "No reports in this window";
  return { slices, total: rows.length, takeaway };
}

/* ------------------------------------------------------------------ *
 * Chart 3 — weekly trend line.                                        *
 * ------------------------------------------------------------------ */

export type WeeklyTrendData = {
  buckets: WeekBucket[]; // exactly `weeks` buckets (contiguous, gaps = 0)
  recentSif: number;
  priorSif: number;
  takeaway: string;
};

/** What: aSIF+pSIF vs recordable per ISO week with a dashed 4-week moving
 *  average on the SIF series. Why: fetches `weeks + 4` so the "versus 4 weeks
 *  ago" takeaway has a prior period even at the smallest filter; bucket maths
 *  is the tested pure function bucketByWeek(). */
export function weeklyTrend(f: OverviewFilter, nowMs: number): WeeklyTrendData {
  const rows = fetchRows(windowStartMonday(nowMs, f.weeks + 4), f.site);
  const all = bucketByWeek(rows, f.weeks + 4, nowMs);
  const buckets = all.slice(4); // displayed window
  const recentSif = buckets.slice(-4).reduce((s, b) => s + b.sif, 0);
  const priorSif = all.slice(0, 4).reduce((s, b) => s + b.sif, 0);
  let takeaway: string;
  if (priorSif === 0 && recentSif === 0) {
    takeaway = "No SIF-potential reports in either period";
  } else if (priorSif === 0) {
    takeaway = `aSIF + pSIF: ${recentSif} this window, none in the 4 weeks before`;
  } else {
    const pct = Math.round(((recentSif - priorSif) / priorSif) * 100);
    const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    takeaway = `aSIF + pSIF are ${pct === 0 ? "level" : `${dir} ${Math.abs(pct)}%`} versus 4 weeks ago`;
  }
  return { buckets, recentSif, priorSif, takeaway };
}

/* ------------------------------------------------------------------ *
 * Chart 4 — density by Life-Saving Rule.                              *
 * ------------------------------------------------------------------ */

export type RuleDensityData = {
  bars: { rule: string; n: number; per1000: number | null }[]; // desc by n
  total: number;
  takeaway: string;
};

/** What: how many reports carry each rule tag, multi-label reports counted
 *  once per distinct rule. Why: per-1,000 normalisation only when a site is
 *  selected (single-site totals are too small to compare raw counts fairly);
 *  tallyRules() is unit-tested for the multi-label behaviour. */
export function ruleDensity(f: OverviewFilter, nowMs: number): RuleDensityData {
  const rows = windowRows(f, nowMs);
  const counts = tallyRules(rows);
  const bars = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule, n]) => ({
      rule,
      n,
      per1000: f.site && rows.length >= SMALL_SAMPLE ? Math.round((n / rows.length) * 1000) : null,
    }));
  const top = bars[0];
  const takeaway = top
    ? `${top.rule} leads with ${top.n} tagged report${top.n === 1 ? "" : "s"}`
    : "No rule tags in this window";
  return { bars, total: rows.length, takeaway };
}

/* ------------------------------------------------------------------ *
 * Chart 5 — top barrier failures.                                     *
 * ------------------------------------------------------------------ */

export type BarrierData = {
  bars: { barrier: string; n: number }[]; // top 6, desc
  sifTotal: number; // aSIF+pSIF reports in window (denominator for context)
  named: number; // of those, how many name any barrier
  takeaway: string;
};

/** What: most frequent barrier_failure among aSIF/pSIF reports only, nulls
 *  skipped, top 6. Why: the column is written at classify time from the
 *  extractor's first barrier; prose artifacts (BARRIER_JUNK) are excluded so
 *  the chart shows real control failures, not fragments. */
export function barrierFailures(f: OverviewFilter, nowMs: number): BarrierData {
  const sifRows = windowRows(f, nowMs).filter((r) => SIF.has(r.tier));
  const counts = new Map<string, number>();
  for (const r of sifRows) {
    const b = r.barrierFailure?.trim().toLowerCase();
    if (!b || BARRIER_JUNK.has(b)) continue;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const bars = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([barrier, n]) => ({ barrier, n }));
  const named = sifRows.filter((r) => {
    const b = r.barrierFailure?.trim().toLowerCase();
    return b && !BARRIER_JUNK.has(b);
  }).length;
  const top = bars[0];
  const takeaway = top
    ? `"${top.barrier}" is the most named failure — ${named} of ${sifRows.length} SIF reports name a barrier`
    : "No SIF report names a barrier in this window";
  return { bars, sifTotal: sifRows.length, named, takeaway };
}

/* ------------------------------------------------------------------ *
 * Chart 6 — site × rule heatmap.                                      *
 * ------------------------------------------------------------------ */

export type HeatDrill = {
  activities: { label: string; n: number }[]; // top 3 in the cell
  barriers: { label: string; n: number }[]; // top 3 missing safeguards
  spark: { key: string; label: string; n: number }[]; // 12 weekly counts
};

export type HeatCell = {
  site: string;
  rule: string;
  n: number; // tagged reports in the filter window
  density: number; // per 100 site reports in window
  recent: number; // per 100, last 4 weeks
  prior: number; // per 100, 4 weeks before that
  escalating: boolean; // recent ≥ prior + ESCALATION_DELTA
  drill: HeatDrill;
};

export type HeatmapData = {
  cells: HeatCell[];
  rules: string[]; // column order (freq desc)
  siteNames: string[]; // row order (volume desc)
  takeaway: string;
};

function topLabels(rows: Row[], pick: (r: Row) => string | null, limit = 3): { label: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = pick(r)?.trim();
    if (!v) continue;
    const key = v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ").toLowerCase();
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, n]) => ({ label, n }));
}

/** What: every site×rule cell with window density plus the fixed 4-week
 *  escalation test and drill-down payload (top activity, top missing
 *  safeguard, 12-week sparkline). Why: drill-down is precomputed server-side
 *  for ALL cells so the chart component stays dumb — selecting a cell needs
 *  no fetch, and "worst site → rule → activity → safeguard" is two clicks.
 *  Fetches ≥12 weeks so the sparkline and prior period exist even at weeks=4. */
export function siteRuleHeatmap(f: OverviewFilter, nowMs: number): HeatmapData {
  const fetchWeeks = Math.max(f.weeks, 12) as number;
  const rows = fetchRows(windowStartMonday(nowMs, fetchWeeks), f.site);

  const winStart = windowStartMonday(nowMs, f.weeks);
  const recentStart = windowStartMonday(nowMs, 4);
  const recentT = parseYmd(recentStart)!.getTime();
  const priorStart = parseYmd(recentStart)!;
  priorStart.setUTCDate(priorStart.getUTCDate() - 28);
  const priorT = priorStart.getTime();

  const siteTotals = new Map<string, { win: number; recent: number; prior: number }>();
  for (const r of rows) {
    const t = parseYmd(r.occurredAt)?.getTime();
    if (t === undefined) continue;
    let s = siteTotals.get(r.site);
    if (!s) siteTotals.set(r.site, (s = { win: 0, recent: 0, prior: 0 }));
    if (r.occurredAt! >= winStart) s.win++;
    if (t >= recentT) s.recent++;
    else if (t >= priorT) s.prior++;
  }

  const ruleTotals = new Map<string, number>();
  const cells = new Map<string, HeatCell>();
  const cellRows = new Map<string, Row[]>();

  for (const r of rows) {
    const rules = distinctRules(r.ruleTags);
    for (const rule of rules) {
      ruleTotals.set(rule, (ruleTotals.get(rule) ?? 0) + 1);
      const key = `${r.site}\u0000${rule}`;
      let cell = cells.get(key);
      if (!cell) {
        cells.set(key, (cell = { site: r.site, rule, n: 0, density: 0, recent: 0, prior: 0, escalating: false, drill: { activities: [], barriers: [], spark: [] } }));
        cellRows.set(key, []);
      }
      cellRows.get(key)!.push(r);
      const t = parseYmd(r.occurredAt)?.getTime();
      if (t === undefined) continue;
      if (r.occurredAt! >= winStart) cell.n++;
      if (t >= recentT) cell.recent++;
      else if (t >= priorT) cell.prior++;
    }
  }

  const out: HeatCell[] = [];
  for (const [key, cell] of cells) {
    if (cell.n === 0) continue; // no tagged reports in the filter window → not a cell
    const totals = siteTotals.get(cell.site) ?? { win: 0, recent: 0, prior: 0 };
    cell.density = Math.round(densityPer100(cell.n, totals.win) * 10) / 10;
    cell.recent = Math.round(densityPer100(cell.recent, totals.recent) * 10) / 10;
    cell.prior = Math.round(densityPer100(cell.prior, totals.prior) * 10) / 10;
    cell.escalating = isEscalating(cell.recent, cell.prior);
    const rs = cellRows.get(key)!;
    cell.drill.activities = topLabels(rs, (r) => r.activity);
    cell.drill.barriers = topLabels(rs, (r) => r.barrierFailure);
    cell.drill.spark = bucketByWeek(rs, 12, nowMs).map((b) => ({ key: b.key, label: b.label, n: b.total }));
    out.push(cell);
  }

  const rules = [...ruleTotals.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const activeSites = new Set(out.map((c) => c.site));
  const siteNames = [...siteTotals.entries()]
    .filter(([s]) => activeSites.has(s))
    .sort((a, b) => b[1].win - a[1].win)
    .map(([s]) => s);
  const esc = out.filter((c) => c.escalating).sort((a, b) => b.recent - b.prior - (a.recent - a.prior));
  const takeaway = esc.length
    ? `${esc.length} cell${esc.length === 1 ? "" : "s"} escalating (+${ESCALATION_DELTA} vs prior 4 weeks) — worst ${esc[0].site} × ${esc[0].rule}`
    : `No site × rule pair breaches +${ESCALATION_DELTA} this month`;

  return { cells: out, rules, siteNames, takeaway };
}

/* ------------------------------------------------------------------ *
 * Chart 7 — model review panel.                                       *
 * ------------------------------------------------------------------ */

export type ModelReviewData = {
  bars: { from: string; to: string; n: number }[]; // original → corrected
  decisions: number;
  corrects: number; // action = 'correct'
  takeaway: string;
};

/** What: every reviewer decision grouped by original → corrected tag.
 *  Why: the flywheel's raw signal — each bar is a place the model was wrong
 *  (or confirmed); corrections are rare early on, so counts are shown as-is
 *  with no percentage. Ignores the window filter: review history is cumulative. */
export function modelReview(): ModelReviewData {
  const rows = getDb()
    .select({
      orig: corrections.originalTag,
      corr: corrections.correctedTag,
      action: corrections.action,
    })
    .from(corrections)
    .all();
  const m = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.orig}\u0000${r.corr}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  const bars = [...m.entries()]
    .map(([k, n]) => {
      const [from, to] = k.split("\u0000");
      return { from, to, n };
    })
    .sort((a, b) => b.n - a.n);
  const corrects = rows.filter((r) => r.action === "correct").length;
  const takeaway = rows.length
    ? `${corrects} of ${rows.length} decisions changed the model's tag — each one trains the next version`
    : "No reviewer decisions yet — the flywheel starts in the review queue";
  return { bars, decisions: rows.length, corrects, takeaway };
}

/* ------------------------------------------------------------------ *
 * Filter parsing.                                                     *
 * ------------------------------------------------------------------ */

/** What: safe searchParams → OverviewFilter. Why: a bad ?weeks= or unknown
 *  ?site= must fall back to the default, never crash the page or leak SQL. */
export function parseFilter(sp: Record<string, string | string[] | undefined>, siteNames: string[]): OverviewFilter {
  const w = Number(sp.weeks);
  const weeks: Weeks = w === 12 || w === 26 ? (w as Weeks) : 4;
  const raw = typeof sp.site === "string" ? sp.site : "";
  const site = raw && siteNames.includes(raw) ? raw : null;
  return { site, weeks };
}
