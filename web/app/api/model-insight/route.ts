/* GET /api/model-insight — the continual-learning story in one payload:
 * active version, champion metrics, the full registry trajectory (every
 * refresh attempt, promoted or gated), and pool/queue stats. */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, modelRegistry, reports } from "@/db/schema";
import { mlApi } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const registry = db.select().from(modelRegistry).all();
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
      released: sql<number>`coalesce(sum(${corrections.releasedToPool}), 0)`,
    })
    .from(corrections)
    .all();

  let service: unknown = null;
  try {
    service = await mlApi.modelInfo();
  } catch {
    /* service offline — sqlite mirror still renders the trajectory */
  }

  return NextResponse.json({
    registry: registry.map((r) => ({
      version: r.version,
      registered_at: r.registeredAt,
      promoted_at: r.promotedAt,
      gate_result: r.gateResult,
      champion_before: r.championBefore,
      sif_recall: r.sifRecall,
      trained_on_rows: r.trainedOnRows,
      note: r.note,
      metrics: r.metrics ? JSON.parse(r.metrics) : null,
    })),
    pool: {
      reports: pool.total,
      sif_positive: pool.sif,
      needs_review: pool.review,
      corrections: corr.n,
      accepts: corr.accepts,
      human_corrections: corr.corrects,
      released_to_pool: corr.released,
    },
    service,
  });
}
