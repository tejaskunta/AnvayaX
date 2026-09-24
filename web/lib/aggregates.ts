/* Shared server-side aggregates: site heatmap rows + model-registry mirror.
 * Used by scripts/seed.ts and POST /api/ingest so numbers never drift. */
import "server-only";

import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import type { DB } from "@/db/client";
import { modelRegistry, reports, sites } from "@/db/schema";

export const SITE_REGION: Record<string, string> = {
  Digboi: "Upper Assam",
  Moran: "Upper Assam",
  Naharkatiya: "Upper Assam",
  Duliajan: "Upper Assam",
  "Jorhat Bypass Road": "Upper Assam",
  "Lumding Terminal": "Central Assam",
  "Guwahati Depot": "Lower Assam",
  Rangia: "Lower Assam",
};

const SIF = new Set(["psif", "asif"]);
const DAY = 86_400_000;

/** Recompute every site row from the reports table (density = SIF-potential per 100). */
export function recomputeSites(db: DB): number {
  const all = db
    .select({
      site: reports.site,
      tier: reports.tier,
      occurredAt: reports.occurredAt,
    })
    .from(reports)
    .all();

  const bySite = new Map<string, typeof all>();
  for (const r of all) {
    if (!bySite.has(r.site)) bySite.set(r.site, []);
    bySite.get(r.site)!.push(r);
  }
  const dates = all
    .map((r) => (r.occurredAt ? Date.parse(r.occurredAt) : NaN))
    .filter((n) => !Number.isNaN(n));
  const maxT = dates.length ? Math.max(...dates) : Date.now();

  const rows: (typeof sites.$inferInsert)[] = [];
  for (const [site, rs] of bySite) {
    const dens = (subset: typeof rs) => {
      if (!subset.length) return 0;
      return (subset.filter((r) => SIF.has(r.tier)).length / subset.length) * 100;
    };
    const dated = rs.filter((r) => r.occurredAt && !Number.isNaN(Date.parse(r.occurredAt)));
    const age = (r: (typeof rs)[number]) => maxT - Date.parse(r.occurredAt!);
    const dRecent = dens(dated.filter((r) => age(r) <= 90 * DAY));
    const dPrior = dens(
      dated.filter((r) => age(r) > 90 * DAY && age(r) <= 180 * DAY)
    );
    const delta = Math.round((dRecent - dPrior) * 10) / 10;
    rows.push({
      name: site,
      region: SITE_REGION[site] ?? "Assam",
      totalReports: rs.length,
      sifPositive: rs.filter((r) => SIF.has(r.tier)).length,
      density: Math.round(dens(rs) * 10) / 10,
      trend: delta > 5 ? "rising" : delta < -5 ? "falling" : "stable",
      deltaDensity: delta,
      updatedAt: new Date().toISOString(),
    });
  }
  rows.sort((a, b) => (b.density ?? 0) - (a.density ?? 0));
  db.delete(sites).run();
  for (const r of rows) db.insert(sites).values(r).run();
  return rows.length;
}

/** Mirror ml-service/model_registry/registry.json into sqlite (Model Insight). */
export function mirrorRegistry(db: DB, mlRoot: string): number {
  const file = path.join(mlRoot, "model_registry", "registry.json");
  if (!fs.existsSync(file)) return 0;
  const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  db.delete(modelRegistry).run();
  for (const r of rows) {
    db.insert(modelRegistry)
      .values({
        version: String(r.version),
        registeredAt: String(r.registered_at ?? ""),
        promotedAt: r.promoted_at ? String(r.promoted_at) : null,
        gateResult: String(r.gate_result ?? "unknown"),
        championBefore: r.champion_before ? String(r.champion_before) : null,
        sifRecall: typeof r.sif_recall === "number" ? r.sif_recall : null,
        metrics: r.metrics ? JSON.stringify(r.metrics) : null,
        trainedOnRows: typeof r.trained_on_rows === "number" ? r.trained_on_rows : null,
        note: r.note ? String(r.note) : null,
      })
      .run();
  }
  return rows.length;
}

export const ML_ROOT = path.resolve(process.cwd(), "..", "ml-service");

export function isSifTier(tier: string): boolean {
  return SIF.has(tier);
}

export const TIER_ORDER = ["near_miss", "recordable", "psif", "asif"] as const;
export function validTier(t: unknown): t is string {
  return typeof t === "string" && TIER_ORDER.includes(t as (typeof TIER_ORDER)[number]);
}
