/* Pure, DB-free helpers for the Portfolio overview charts.
 * Everything here is unit-testable (see lib/__tests__/overview.test.ts):
 * ISO-week bucketing, multi-label rule counting, and the escalation test.
 * No server-only / react imports so Vitest can pull them directly. */

/** Density points (per 100 reports) a cell must gain to read as "escalating". */
export const ESCALATION_DELTA = 8;

/** Tiers that count as SIF-potential-or-actual. */
export const SIF_TIERS = new Set(["psif", "asif"]);

export type OccTier = { occurredAt: string | null; tier: string };

/* ------------------------------------------------------------------ *
 * ISO-week date math (UTC-only, so timezone offsets can't shift a     *
 * report into the wrong week — see the localStorage/streak lesson).   *
 * ------------------------------------------------------------------ */

/** Parse a `yyyy-mm-dd[THH:MM…]` string into a UTC midnight Date. */
export function parseYmd(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The `yyyy-mm-dd` of the Monday that starts this date's ISO week. */
export function weekStartMonday(input: string | number | Date): string {
  const d = input instanceof Date ? input : typeof input === "number" ? new Date(input) : parseYmd(input);
  if (!d || Number.isNaN(d.getTime())) throw new Error(`weekStartMonday: bad date ${String(input)}`);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const offsetFromMon = (day + 6) % 7; // Mon=0 … Sun=6
  return ymd(new Date(d.getTime() - offsetFromMon * 86_400_000));
}

/** ISO 8601 year + week number for a date (week 01 = week containing 4 Jan). */
export function isoWeek(input: string | number | Date): { year: number; week: number } {
  const d = input instanceof Date ? input : typeof input === "number" ? new Date(input) : parseYmd(input);
  if (!d || Number.isNaN(d.getTime())) throw new Error(`isoWeek: bad date ${String(input)}`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7; // Mon=1 … Sun=7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum); // move to this week's Thursday
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
}

/** Short axis label, e.g. "W40". */
export function isoWeekLabel(input: string | number | Date): string {
  return `W${isoWeek(input).week}`;
}

/** Monday of the `weeks`-week window ending at the week containing `nowMs`. */
export function windowStartMonday(nowMs: number, weeks: number): string {
  const thisMon = weekStartMonday(nowMs);
  const d = parseYmd(thisMon)!;
  return ymd(new Date(d.getTime() - (weeks - 1) * 7 * 86_400_000));
}

/* ------------------------------------------------------------------ *
 * Weekly trend bucketing.                                            *
 * ------------------------------------------------------------------ */

export type WeekBucket = {
  key: string; // Monday yyyy-mm-dd — stable join key
  label: string; // "W40"
  startMs: number;
  sif: number; // psif + asif
  recordable: number;
  total: number; // all tiers this week
  sifMa: number | null; // trailing 4-week mean of `sif`; null until 4 buckets
};

/**
 * Bucket reports into a contiguous run of `weeks` ISO weeks ending at the week
 * containing `nowMs`. Empty weeks are kept (honest gaps → zero, not skipped).
 * Reports with no/invalid date are ignored; reports outside the window drop out.
 */
export function bucketByWeek(rows: OccTier[], weeks: number, nowMs: number): WeekBucket[] {
  const start = parseYmd(windowStartMonday(nowMs, weeks))!;
  const buckets: WeekBucket[] = [];
  const index = new Map<string, number>();
  for (let i = 0; i < weeks; i++) {
    const monday = new Date(start.getTime() + i * 7 * 86_400_000);
    const key = ymd(monday);
    index.set(key, buckets.length);
    buckets.push({ key, label: isoWeekLabel(monday), startMs: monday.getTime(), sif: 0, recordable: 0, total: 0, sifMa: null });
  }
  for (const r of rows) {
    const d = parseYmd(r.occurredAt);
    if (!d) continue;
    const idx = index.get(weekStartMonday(d));
    if (idx === undefined) continue;
    const b = buckets[idx];
    b.total++;
    if (SIF_TIERS.has(r.tier)) b.sif++;
    else if (r.tier === "recordable") b.recordable++;
  }
  // trailing 4-week mean of the SIF series (window includes the current bucket)
  for (let i = 0; i < buckets.length; i++) {
    if (i < 3) continue;
    const win = buckets.slice(i - 3, i + 1);
    buckets[i].sifMa = Math.round((win.reduce((s, b) => s + b.sif, 0) / 4) * 100) / 100;
  }
  return buckets;
}

/* ------------------------------------------------------------------ *
 * Multi-label rule counting.                                         *
 * ------------------------------------------------------------------ */

/** Distinct rule names tagged on ONE report (deduped — a report counts once/rule). */
export function distinctRules(ruleTags: unknown): string[] {
  let parsed: unknown = ruleTags;
  if (typeof ruleTags === "string") {
    try {
      parsed = JSON.parse(ruleTags);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out = new Set<string>();
  for (const t of parsed) {
    const rule = (t as { rule?: unknown })?.rule;
    if (typeof rule === "string" && rule.trim()) out.add(rule.trim());
  }
  return [...out];
}

/** Count reports per rule across many reports; multi-label reports feed several rules. */
export function tallyRules(reports: { ruleTags: unknown }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of reports) {
    for (const rule of distinctRules(r.ruleTags)) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------ *
 * Density + escalation.                                              *
 * ------------------------------------------------------------------ */

/** Rate per 100 reports (0 when the denominator is empty — never divide by zero). */
export function densityPer100(count: number, total: number): number {
  if (total <= 0) return 0;
  return (count / total) * 100;
}

/** A site×rule cell escalates when recent density gains ≥ ESCALATION_DELTA over prior. */
export function isEscalating(recentPer100: number, priorPer100: number, delta: number = ESCALATION_DELTA): boolean {
  return recentPer100 >= priorPer100 + delta;
}
