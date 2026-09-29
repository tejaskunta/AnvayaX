/* Seed the demo DB: 750 HSSE reports (550 L3 synthetic + 200 L2 domain) run
 * through the live ML service (/classify-batch), persisted with embeddings,
 * plus site aggregates, batch audit rows, and a mirror of the model registry.
 *
 * Prereqs: ml-service running on :8000 with data/exemplars.json built.
 * Usage:  cd web && npx tsx scripts/seed.ts   (idempotent — resets tables)
 *
 * NOTE: db/client.ts imports "server-only" (throws under tsx), so this script
 * opens its own better-sqlite3 connection against the same file. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

import * as schema from "../db/schema";
import { mlApi, type ClassifyResult } from "../lib/api";
import { normalizeDateCell } from "../lib/dates";

const WEB_ROOT = path.resolve(__dirname, "..");
const ML_ROOT = path.resolve(WEB_ROOT, "..", "ml-service");
const DB_PATH = process.env.DATABASE_URL ?? path.join(WEB_ROOT, "db", "sqlite.db");

const SITE_REGION: Record<string, string> = {
  Digboi: "Upper Assam",
  Moran: "Upper Assam",
  Naharkatiya: "Upper Assam",
  Duliajan: "Upper Assam",
  "Jorhat Bypass Road": "Upper Assam",
  "Lumding Terminal": "Central Assam",
  "Guwahati Depot": "Lower Assam",
  Rangia: "Lower Assam",
};

type CsvRow = {
  id: string;
  text: string;
  tier: string;
  site: string;
  activity: string;
  occurred_at: string;
  is_synthetic: string;
};

function readCsv(file: string): CsvRow[] {
  const wb = XLSX.read(fs.readFileSync(file, "utf8"), { type: "string" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" }).map(
    (r) => ({
      id: String(r.id ?? ""),
      text: String(r.text ?? ""),
      tier: String(r.tier ?? ""),
      site: String(r.site ?? ""),
      activity: String(r.activity ?? ""),
      occurred_at: normalizeDateCell(r.occurred_at) ?? "",
      is_synthetic: String(r.is_synthetic ?? "1"),
    })
  );
}

/** Deterministic pseudo-random date in [minDate, maxDate] for rows missing occurred_at. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), 61 | t))) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embeddingToBlob(emb: number[] | null): Buffer | null {
  if (!emb || !emb.length) return null;
  return Buffer.from(new Float32Array(emb).buffer);
}

async function classifyAll(rows: CsvRow[]): Promise<ClassifyResult[]> {
  const out: ClassifyResult[] = [];
  const CHUNK = 250; // CPU inference: ~1-2 min per chunk
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    process.stdout.write(
      `  classify-batch ${i + 1}..${i + chunk.length} (${chunk.length} texts)...\n`
    );
    const { results } = await mlApi.classifyBatch(chunk.map((r) => r.text));
    if (results.length !== chunk.length)
      throw new Error(`batch size mismatch: ${results.length} != ${chunk.length}`);
    out.push(...results);
  }
  return out;
}

function recomputeSites(db: ReturnType<typeof drizzle<typeof schema>>) {
  const all = db.select().from(schema.reports).all();
  const bySite = new Map<string, typeof all>();
  for (const r of all) {
    if (!bySite.has(r.site)) bySite.set(r.site, []);
    bySite.get(r.site)!.push(r);
  }
  // Trend: SIF density in the most recent 90-day window vs the prior 90 days,
  // anchored at the latest occurred date in the dataset.
  const dates = all
    .map((r) => (r.occurredAt ? Date.parse(r.occurredAt) : NaN))
    .filter((n) => !Number.isNaN(n));
  const maxT = dates.length ? Math.max(...dates) : Date.now();
  const DAY = 86_400_000;

  const rows: (typeof schema.sites.$inferInsert)[] = [];
  for (const [site, rs] of bySite) {
    const dens = (subset: typeof rs) => {
      if (!subset.length) return 0;
      const sif = subset.filter((r) => r.tier === "psif" || r.tier === "asif").length;
      return (sif / subset.length) * 100;
    };
    const dated = rs.filter((r) => r.occurredAt && !Number.isNaN(Date.parse(r.occurredAt)));
    const recent = dated.filter((r) => maxT - Date.parse(r.occurredAt!) <= 90 * DAY);
    const prior = dated.filter(
      (r) => maxT - Date.parse(r.occurredAt!) > 90 * DAY && maxT - Date.parse(r.occurredAt!) <= 180 * DAY
    );
    const dRecent = dens(recent);
    const dPrior = dens(prior);
    const delta = Math.round((dRecent - dPrior) * 10) / 10;
    const trend = delta > 5 ? "rising" : delta < -5 ? "falling" : "stable";
    rows.push({
      name: site,
      region: SITE_REGION[site] ?? "Assam",
      totalReports: rs.length,
      sifPositive: rs.filter((r) => r.tier === "psif" || r.tier === "asif").length,
      density: Math.round(dens(rs) * 10) / 10,
      trend,
      deltaDensity: delta,
    });
  }
  rows.sort((a, b) => (b.density ?? 0) - (a.density ?? 0));
  db.delete(schema.sites).run();
  for (const r of rows) {
    db.insert(schema.sites).values({ ...r, updatedAt: new Date().toISOString() }).run();
  }
  console.log(`sites: ${rows.length} rows (trend window anchored ${new Date(maxT).toISOString().slice(0, 10)})`);
}

function mirrorRegistry(db: ReturnType<typeof drizzle<typeof schema>>) {
  const regFile = path.join(ML_ROOT, "model_registry", "registry.json");
  if (!fs.existsSync(regFile)) return console.log("registry: none yet");
  const rows = JSON.parse(fs.readFileSync(regFile, "utf8")) as Array<Record<string, unknown>>;
  db.delete(schema.modelRegistry).run();
  for (const r of rows) {
    db.insert(schema.modelRegistry)
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
  console.log(`registry: mirrored ${rows.length} version(s)`);
}

async function main() {
  console.log("== AnvayaX seed ==");
  const health = await mlApi.health().catch((e) => {
    console.error("ML service not reachable:", e.message);
    process.exit(1);
  });
  console.log(`ml-service: ${health.status} mode=${health.mode} active=${health.active_version}`);

  const l3 = readCsv(path.join(ML_ROOT, "labeling", "labeled_set.csv"));
  const l2 = readCsv(path.join(ML_ROOT, "labeling", "domain_rows.csv"));
  console.log(`rows: L3=${l3.length} L2=${l2.length} total=${l3.length + l2.length}`);

  // Deterministic dates for L2 rows that lack occurred_at (2025-04-01 .. 2026-09-20)
  const rnd = mulberry32(20260922);
  const minT = Date.parse("2025-04-01");
  const span = Date.parse("2026-09-20") - minT;
  for (const r of l2) {
    if (!r.occurred_at) r.occurred_at = new Date(minT + rnd() * span).toISOString().slice(0, 10);
  }

  const all = [...l3, ...l2];
  console.log("classifying through the champion model...");
  const t0 = Date.now();
  const results = await classifyAll(all);
  console.log(`classified ${results.length} texts in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  // Reset (seed is a full refresh of the demo DB — corrections are wiped too)
  db.delete(schema.corrections).run();
  db.delete(schema.reports).run();
  db.delete(schema.batches).run();
  db.delete(schema.sites).run();

  const now = new Date().toISOString();
  const batchIds: Record<string, string> = {
    "labeled_set.csv": `seed-l3-${now.slice(0, 10)}`,
    "domain_rows.csv": `seed-l2-${now.slice(0, 10)}`,
  };
  for (const [file, bid] of Object.entries(batchIds)) {
    const count = file === "labeled_set.csv" ? l3.length : l2.length;
    db.insert(schema.batches)
      .values({
        id: bid,
        filename: `ml-service/labeling/${file}`,
        rowCount: count,
        insertedCount: count,
        skippedDuplicates: 0,
        source: "seed",
        createdAt: now,
      })
      .run();
  }

  let inserted = 0;
  for (let i = 0; i < all.length; i++) {
    const row = all[i];
    const res = results[i];
    db.insert(schema.reports)
      .values({
        id: row.id,
        rawText: row.text,
        tier: res.tier,
        confidence: res.confidence,
        severityIndex: res.severity_index,
        tierProbs: JSON.stringify(res.tiers),
        ruleTags: JSON.stringify(res.rule_tags),
        precursors: JSON.stringify(res.precursors),
        embedding: embeddingToBlob(res.embedding),
        site: row.site,
        activity: row.activity || res.precursors?.activities?.[0] || null,
        barrierFailure: res.precursors?.barrier_failures?.[0] ?? null,
        occurredAt: row.occurred_at || null,
        sourceLayer: i < l3.length ? "l3_synthetic" : "l2_domain",
        isSynthetic: row.is_synthetic === "1" ? 1 : 0,
        needsReview: res.needs_review ? 1 : 0,
        acquisitionScore: res.acquisition_score ?? 0,
        modelVersion: res.model_version,
        batchId: i < l3.length ? batchIds["labeled_set.csv"] : batchIds["domain_rows.csv"],
        createdAt: now,
      })
      .run();
    inserted++;
  }
  console.log(`reports: ${inserted} inserted`);

  recomputeSites(db);
  mirrorRegistry(db);

  // Quick sanity summary
  const tierCounts = db
    .select({ tier: schema.reports.tier, n: schema.reports.tier })
    .from(schema.reports)
    .all()
    .reduce<Record<string, number>>((acc, r) => ((acc[r.tier] = (acc[r.tier] ?? 0) + 1), acc), {});
  const review = db.select().from(schema.reports).all().filter((r) => r.needsReview).length;
  console.log("tier distribution (model-predicted):", tierCounts);
  console.log(`needs_review: ${review} (${((review / inserted) * 100).toFixed(1)}%)`);
  console.log("== seed complete ==");
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
