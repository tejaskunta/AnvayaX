/* POST /api/analyze — single free-text report: classify via ML service,
 * persist, and return the verdict + top-5 most similar past reports
 * (cosine over stored MiniLM embeddings) + extracted SIF precursors. */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { reports } from "@/db/schema";
import { mlApi } from "@/lib/api";
import { blobToEmbedding, cosine, embeddingToBlob } from "@/lib/ingest";
import { recomputeSites } from "@/lib/aggregates";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 10) {
    return NextResponse.json({ error: "text must be at least 10 characters" }, { status: 400 });
  }
  const site = typeof body?.site === "string" && body.site.trim() ? body.site.trim() : "Unassigned";
  const activity = typeof body?.activity === "string" ? body.activity.trim() : null;

  let res;
  try {
    res = await mlApi.classify(text);
  } catch (e) {
    return NextResponse.json({ error: `ML service unreachable: ${String(e)}` }, { status: 502 });
  }

  const db = getDb();
  const id = `web-${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  db.insert(reports)
    .values({
      id,
      rawText: text,
      tier: res.tier,
      confidence: res.confidence,
      severityIndex: res.severity_index,
      tierProbs: JSON.stringify(res.tiers),
      ruleTags: JSON.stringify(res.rule_tags),
      precursors: JSON.stringify(res.precursors),
      embedding: embeddingToBlob(res.embedding),
      site,
      activity,
      occurredAt: now.slice(0, 10),
      sourceLayer: "manual",
      isSynthetic: 0,
      needsReview: res.needs_review ? 1 : 0,
      acquisitionScore: res.acquisition_score ?? 0,
      modelVersion: res.model_version,
      batchId: null,
      createdAt: now,
    })
    .run();
  recomputeSites(db);

  // Top-5 nearest neighbours among previously stored reports.
  const q = res.embedding ? Float32Array.from(res.embedding) : null;
  let similar: unknown[] = [];
  if (q) {
    similar = db
      .select({
        id: reports.id,
        rawText: reports.rawText,
        tier: reports.tier,
        severityIndex: reports.severityIndex,
        site: reports.site,
        occurredAt: reports.occurredAt,
        embedding: reports.embedding,
      })
      .from(reports)
      .all()
      .filter((r) => r.id !== id)
      .map((r) => {
        const e = blobToEmbedding(r.embedding as Uint8Array | null);
        return {
          id: r.id,
          excerpt: r.rawText.slice(0, 220),
          tier: r.tier,
          severity_index: r.severityIndex,
          site: r.site,
          occurred_at: r.occurredAt,
          similarity: e ? Math.round(cosine(e, q) * 1000) / 1000 : 0,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  return NextResponse.json({
    report_id: id,
    result: res,
    similar_reports: similar,
  });
}
