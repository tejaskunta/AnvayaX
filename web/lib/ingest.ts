/* Ingest core shared by /api/ingest (file upload), /api/analyze (single text),
 * and scripts/seed.ts-style bulk loads: classify via the ML service, persist
 * a report row, and refresh site aggregates. The web layer never computes
 * tiers itself — the service is the single source of model truth. */
import "server-only";

import { randomUUID } from "node:crypto";

import { mlApi, type ClassifyResult } from "@/lib/api";
import { normalizeDateCell } from "@/lib/dates";
import type { DB } from "@/db/client";
import { batches, reports } from "@/db/schema";
import { recomputeSites } from "@/lib/aggregates";

export type IngestRowInput = {
  id?: string;
  text: string;
  site?: string;
  activity?: string;
  occurredAt?: string;
  sourceLayer?: string; // l2_domain | l3_synthetic | manual | upload
  isSynthetic?: boolean;
};

export type IngestSummary = {
  batchId: string;
  rowCount: number;
  inserted: number;
  skippedDuplicates: number;
  tiers: Record<string, number>;
  sifPotential: number;
  needsReview: number;
};

export function embeddingToBlob(emb: number[] | null): Buffer | null {
  if (!emb || !emb.length) return null;
  return Buffer.from(new Float32Array(emb).buffer);
}

export function blobToEmbedding(blob: Buffer | Uint8Array | null): Float32Array | null {
  if (!blob) return null;
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
}

export function cosine(a: Float32Array | number[], b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

function tierOf(res: ClassifyResult): string {
  return res.tier;
}

/** Classify + persist a set of rows in one batch. Duplicate ids are skipped. */
export async function ingestRows(
  db: DB,
  rows: IngestRowInput[],
  opts: { filename?: string; source: string }
): Promise<IngestSummary> {
  const batchId = `${opts.source}-${randomUUID().slice(0, 8)}`;
  const existing = new Set(
    db
      .select({ id: reports.id })
      .from(reports)
      .all()
      .map((r) => r.id)
  );

  const fresh: { row: IngestRowInput; id: string }[] = [];
  let skipped = 0;
  for (const row of rows) {
    const id = row.id?.trim() || `web-${randomUUID().slice(0, 12)}`;
    if (existing.has(id) || !row.text.trim()) {
      skipped++;
      continue;
    }
    existing.add(id);
    fresh.push({ row, id });
  }

  const tiers: Record<string, number> = {};
  let sif = 0;
  let review = 0;
  const now = new Date().toISOString();

  // Chunk to keep each request under the service's 500-text cap and bound RAM.
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100);
    const { results } = await mlApi.classifyBatch(chunk.map((f) => f.row.text));
    chunk.forEach(({ row, id }, j) => {
      const res = results[j];
      const t = tierOf(res);
      tiers[t] = (tiers[t] ?? 0) + 1;
      if (t === "psif" || t === "asif") sif++;
      if (res.needs_review) review++;
      db.insert(reports)
        .values({
          id,
          rawText: row.text,
          tier: t,
          confidence: res.confidence,
          severityIndex: res.severity_index,
          tierProbs: JSON.stringify(res.tiers),
          ruleTags: JSON.stringify(res.rule_tags),
          precursors: JSON.stringify(res.precursors),
          embedding: embeddingToBlob(res.embedding),
          site: row.site?.trim() || "Unassigned",
          activity: row.activity?.trim() || null,
          occurredAt: normalizeDateCell(row.occurredAt),
          sourceLayer: row.sourceLayer ?? "manual",
          isSynthetic: row.isSynthetic ? 1 : 0,
          needsReview: res.needs_review ? 1 : 0,
          acquisitionScore: res.acquisition_score ?? 0,
          modelVersion: res.model_version,
          batchId,
          createdAt: now,
        })
        .run();
    });
  }

  db.insert(batches)
    .values({
      id: batchId,
      filename: opts.filename ?? null,
      rowCount: rows.length,
      insertedCount: fresh.length,
      skippedDuplicates: skipped,
      source: opts.source,
      createdAt: now,
    })
    .run();

  if (fresh.length) recomputeSites(db);

  return {
    batchId,
    rowCount: rows.length,
    inserted: fresh.length,
    skippedDuplicates: skipped,
    tiers,
    sifPotential: sif,
    needsReview: review,
  };
}
