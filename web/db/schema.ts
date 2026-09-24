import { sql } from "drizzle-orm";
import {
  blob,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** One ingested HSSE report + the champion model's verdict. */
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(), // L3-0001 / L2-0042 / web-<uuid> / ingest batch row id
  rawText: text("raw_text").notNull(),
  tier: text("tier").notNull(), // near_miss | recordable | psif | asif (model argmax)
  confidence: real("confidence").notNull(),
  severityIndex: real("severity_index").notNull(), // 25..100 ordinal sub-rank
  tierProbs: text("tier_probs").notNull(), // json {tier: p}
  ruleTags: text("rule_tags").notNull(), // json [{rule, matched_phrases, confidence}]
  precursors: text("precursors").notNull(), // json {activities, locations, barrier_failures, energy_sources}
  embedding: blob("embedding"), // Float32Array bytes, 384 dims
  site: text("site").notNull(),
  activity: text("activity"),
  occurredAt: text("occurred_at"), // ISO date
  sourceLayer: text("source_layer").notNull(), // l2_domain | l3_synthetic | manual
  isSynthetic: integer("is_synthetic").notNull().default(0),
  needsReview: integer("needs_review").notNull().default(0),
  acquisitionScore: real("acquisition_score").notNull().default(0),
  modelVersion: text("model_version").notNull(),
  batchId: text("batch_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Site-level aggregates, recomputed by scripts/seed.ts + refresh (heatmap source). */
export const sites = sqliteTable(
  "sites",
  {
    name: text("name").primaryKey(),
    region: text("region").notNull(),
    totalReports: integer("total_reports").notNull().default(0),
    sifPositive: integer("sif_positive").notNull().default(0), // psif + asif
    density: real("density").notNull().default(0), // SIF-potential per 100 reports
    trend: text("trend").notNull().default("stable"), // rising | stable | falling
    deltaDensity: real("delta_density").notNull().default(0), // recent vs prior window
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  }
);

/** Human Review-Queue decisions — the training signal for the continual loop. */
export const corrections = sqliteTable("corrections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: text("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  originalTag: text("original_tag").notNull(),
  correctedTag: text("corrected_tag").notNull(), // same as original on "accept"
  action: text("action").notNull(), // accept | correct
  correctedBy: text("corrected_by").notNull().default("reviewer"),
  releasedToPool: integer("released_to_pool").notNull().default(0), // 1 once exported to /train
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Ingest audit trail. */
export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  filename: text("filename"),
  rowCount: integer("row_count").notNull(),
  insertedCount: integer("inserted_count").notNull(),
  skippedDuplicates: integer("skipped_duplicates").notNull().default(0),
  source: text("source").notNull(), // upload | seed | sandbox
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Mirror of ml-service/model_registry rows for the Model Insight trajectory. */
export const modelRegistry = sqliteTable("model_registry", {
  version: text("version").primaryKey(), // v1, v2, ...
  registeredAt: text("registered_at").notNull(),
  promotedAt: text("promoted_at"),
  gateResult: text("gate_result").notNull(), // PROMOTED | REJECTED | first_model
  championBefore: text("champion_before"),
  sifRecall: real("sif_recall"),
  metrics: text("metrics"), // json
  trainedOnRows: integer("trained_on_rows"),
  note: text("note"),
});

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type Correction = typeof corrections.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type ModelRegistryRow = typeof modelRegistry.$inferSelect;
