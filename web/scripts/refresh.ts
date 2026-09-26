/* The headline feature: scheduled model refresh.
 *
 *   1. Assemble the training pool = every gold-labelled row in the DB
 *      (synthetic L3 + human-reviewed rows) — replay-from-base, never incremental.
 *   2. POST the pool to ml-service /train (LoRA challenger + frozen-gate
 *      champion/challenger comparison happens server-side).
 *   3. If promoted: re-classify the whole corpus under the new champion so the
 *      UI shows the improved model's verdicts, rebuild the exemplar store, and
 *      mirror the registry.
 *
 * Usage:  cd web && node_modules/.bin/tsx scripts/refresh.ts [--dry-run]
 * Cron:   every REFRESH_INTERVAL_DAYS (see docs/cron.md) — manual trigger here
 * is the demo path: npx tsx scripts/refresh.ts */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";

import * as schema from "../db/schema";
import { corrections, modelRegistry, reports, sites } from "../db/schema";
import { mlApi } from "../lib/api";

const WEB_ROOT = process.cwd();
const ML_ROOT = path.resolve(WEB_ROOT, "..", "ml-service");
const DB_PATH = process.env.DATABASE_URL ?? path.join(WEB_ROOT, "db", "sqlite.db");
// venv layout differs by OS: POSIX uses bin/python, Windows Scripts\python.exe.
const PY = process.env.ML_PYTHON ??
  path.join(ML_ROOT, ".venv", process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python");
const DRY = process.argv.includes("--dry-run");

const SIF = new Set(["psif", "asif"]);

async function main() {
  console.log("== AnvayaX refresh ==");
  const health = await mlApi.health();
  console.log(`ml-service: active=${health.active_version} mode=${health.mode}`);
  const before = health.active_version;

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  // 1. Training pool — GOLD labels only, never the model's own predictions:
  //    a) L3 synthetic rows: gold tier from ml-service/labeling/labeled_set.csv
  //       (joined by report id; the DB `tier` column is the v1 prediction and
  //       must not leak into training).
  //    b) Reviewer corrections: the corrected tag is gold by definition and
  //       overrides everything (manual, upload, or even L3 rows).
  //    L2 domain rows have no gold label -> excluded until reviewed.
  const TIERS = new Set(["near_miss", "recordable", "psif", "asif"]);
  const goldCsv = new Map<string, { text: string; tier: string }>();
  const wb = XLSX.read(
    fs.readFileSync(path.join(ML_ROOT, "labeling", "labeled_set.csv"), "utf8"),
    { type: "string" }
  );
  for (const r of XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], {
    defval: "",
  })) {
    if (TIERS.has(String(r.tier)))
      goldCsv.set(String(r.id), { text: String(r.text), tier: String(r.tier) });
  }

  const pool = new Map<string, { text: string; tier: string }>();
  const dbIds = new Set(
    db
      .select({ id: reports.id, layer: reports.sourceLayer })
      .from(reports)
      .where(eq(reports.sourceLayer, "l3_synthetic"))
      .all()
      .map((r) => r.id)
  );
  for (const id of dbIds) {
    const g = goldCsv.get(id);
    if (g) pool.set(id, g);
  }
  let correctionRows = 0;
  for (const c of db.select().from(corrections).all()) {
    const rep = db.select({ text: reports.rawText }).from(reports).where(eq(reports.id, c.reportId)).all()[0];
    if (rep && TIERS.has(c.correctedTag)) {
      pool.set(c.reportId, { text: rep.text, tier: c.correctedTag });
      correctionRows++;
    }
  }
  // Exclude the frozen regression set (gate honesty) and quarantined
  // double-annotation disagreements (untrusted labels).
  const regFile = path.join(ML_ROOT, "labeling", "regression_set.csv");
  const regIds = new Set(
    fs
      .readFileSync(regFile, "utf8")
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.split(",")[0])
      .filter(Boolean)
  );
  const splits = JSON.parse(
    fs.readFileSync(path.join(ML_ROOT, "labeling", "splits.json"), "utf8")
  ) as { quarantined: string[] };
  const excluded = new Set([...regIds, ...splits.quarantined]);
  for (const id of excluded) pool.delete(id);

  const rows = [...pool.entries()].map(([id, v]) => ({ id, ...v }));
  const dist = rows.reduce<Record<string, number>>((a, r) => ((a[r.tier] = (a[r.tier] ?? 0) + 1), a), {});
  console.log(
    `pool: ${rows.length} rows (gold L3 + ${correctionRows} reviewer corrections; regression excluded: ${regIds.size}) dist=${JSON.stringify(dist)}`
  );
  if (DRY) {
    console.log("--dry-run: not sending to /train");
    sqlite.close();
    return;
  }

  // 2. Train challenger + gate (server-side; minutes on CPU).
  const t0 = Date.now();
  const res = await mlApi.train(
    rows.map((r) => ({ text: r.text, tier: r.tier })),
    `refresh ${new Date().toISOString().slice(0, 16)} pool=${rows.length}`
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(
    `gate: promoted=${res.gate.promoted} challenger=${res.gate.challenger_version} ` +
      `recall ${res.gate.sif_recall_champion?.toFixed(4)} -> ${res.gate.sif_recall_challenger?.toFixed(4)} ` +
      `(delta ${res.gate.delta_pp}pp) in ${secs}s`
  );
  console.log(`reason: ${res.gate.reason}`);

  // 3a. Mirror registry regardless of outcome — rejected attempts are history too.
  const reg = JSON.parse(
    fs.readFileSync(path.join(ML_ROOT, "model_registry", "registry.json"), "utf8")
  ) as Array<Record<string, unknown>>;
  db.delete(modelRegistry).run();
  for (const r of reg) {
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

  if (!res.gate.promoted) {
    console.log("champion retained — corpus untouched.");
    sqlite.close();
    return;
  }

  // 3b. New champion: rebuild exemplars (train pool embeddings) then re-classify.
  console.log("rebuilding exemplar store...");
  execFileSync(PY, ["-m", "scripts.build_exemplars"], { cwd: ML_ROOT, stdio: "inherit" });

  console.log("reclassifying corpus under the new champion...");
  const all = db
    .select({
      id: reports.id,
      text: reports.rawText,
      site: reports.site,
      activity: reports.activity,
      occurredAt: reports.occurredAt,
      sourceLayer: reports.sourceLayer,
      isSynthetic: reports.isSynthetic,
    })
    .from(reports)
    .all();
  const CHUNK = 250;
  let updated = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const { results } = await mlApi.classifyBatch(chunk.map((r) => r.text));
    chunk.forEach((r, j) => {
      const res2 = results[j];
      db.update(reports)
        .set({
          tier: res2.tier,
          confidence: res2.confidence,
          severityIndex: res2.severity_index,
          tierProbs: JSON.stringify(res2.tiers),
          ruleTags: JSON.stringify(res2.rule_tags),
          precursors: JSON.stringify(res2.precursors),
          embedding: res2.embedding ? Buffer.from(new Float32Array(res2.embedding).buffer) : null,
          needsReview: res2.needs_review ? 1 : 0,
          acquisitionScore: res2.acquisition_score ?? 0,
          modelVersion: res2.model_version,
        })
        .where(eq(reports.id, r.id))
        .run();
      updated++;
    });
    process.stdout.write(`  ${updated}/${all.length}\n`);
  }

  // 3c. Reviewer-corrected rows keep their gold tier (model must not overwrite humans).
  for (const c of db.select().from(corrections).all()) {
    db.update(reports).set({ tier: c.correctedTag, needsReview: 0 }).where(eq(reports.id, c.reportId)).run();
  }

  // 3d. Site aggregates (keep prior region, refresh counts + trend).
  const priorSites = new Map(db.select().from(sites).all().map((s) => [s.name, s]));
  const DAY_MS = 86_400_000;
  const rs = db
    .select({ site: reports.site, tier: reports.tier, occurredAt: reports.occurredAt })
    .from(reports)
    .all();
  const bySite = new Map<string, typeof rs>();
  const dates: number[] = [];
  for (const r of rs) {
    if (!bySite.has(r.site)) bySite.set(r.site, []);
    bySite.get(r.site)!.push(r);
    const t = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
    if (!Number.isNaN(t)) dates.push(t);
  }
  const maxT = dates.length ? Math.max(...dates) : Date.now();
  db.delete(sites).run();
  for (const [name, rows] of bySite) {
    const dens = (sub: typeof rows) =>
      sub.length ? (sub.filter((r) => SIF.has(r.tier)).length / sub.length) * 100 : 0;
    const dated = rows.filter((r) => r.occurredAt && !Number.isNaN(Date.parse(r.occurredAt)));
    const age = (r: (typeof rows)[number]) => maxT - Date.parse(r.occurredAt!);
    const delta =
      Math.round((dens(dated.filter((r) => age(r) <= 90 * DAY_MS)) -
        dens(dated.filter((r) => age(r) > 90 * DAY_MS && age(r) <= 180 * DAY_MS))) * 10) / 10;
    const sif = rows.filter((r) => SIF.has(r.tier)).length;
    db.insert(sites)
      .values({
        name,
        region: priorSites.get(name)?.region ?? "Assam",
        totalReports: rows.length,
        sifPositive: sif,
        density: Math.round(dens(rows) * 10) / 10,
        trend: delta > 5 ? "rising" : delta < -5 ? "falling" : "stable",
        deltaDensity: delta,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }

  const after = await mlApi.health();
  console.log(`done: ${before} -> ${after.active_version}, ${updated} reports reclassified.`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
