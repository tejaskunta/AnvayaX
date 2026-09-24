/* GET /api/queue — the human review queue: reports the model is least sure
 * about, ranked by acquisition_score (entropy + kNN novelty). This is the
 * front door of the continual-learning loop: reviewing these rows is what
 * makes the next refresh smarter. */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, or, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, reports } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const db = getDb();
  const limit = Math.min(Number(sp.get("limit") ?? 25) || 25, 100);
  const site = sp.get("site");

  // Queue = needs_review rows OR high-novelty rows, minus anything already resolved.
  const resolved = sql`exists (select 1 from ${corrections} where ${corrections.reportId} = ${reports.id})`;
  const conds = [or(eq(reports.needsReview, 1), sql`${reports.acquisitionScore} >= 0.55`), sql`not ${resolved}`];
  if (site) conds.push(eq(reports.site, site));

  const rows = db
    .select({
      id: reports.id,
      rawText: reports.rawText,
      tier: reports.tier,
      confidence: reports.confidence,
      severityIndex: reports.severityIndex,
      tierProbs: reports.tierProbs,
      ruleTags: reports.ruleTags,
      precursors: reports.precursors,
      site: reports.site,
      activity: reports.activity,
      occurredAt: reports.occurredAt,
      sourceLayer: reports.sourceLayer,
      acquisitionScore: reports.acquisitionScore,
      modelVersion: reports.modelVersion,
    })
    .from(reports)
    .where(and(...conds))
    .orderBy(desc(reports.acquisitionScore), desc(reports.severityIndex))
    .limit(limit)
    .all();

  const queueTotal = db
    .select({ n: sql<number>`count(*)` })
    .from(reports)
    .where(and(or(eq(reports.needsReview, 1), sql`${reports.acquisitionScore} >= 0.55`), sql`not ${resolved}`))
    .all()[0].n;
  const resolvedCount = db.select({ n: sql<number>`count(*)` }).from(corrections).all()[0].n;

  return NextResponse.json({
    queue_total: queueTotal,
    resolved_total: resolvedCount,
    queue: rows.map((r) => ({
      ...r,
      excerpt: r.rawText.slice(0, 400),
      rawText: undefined,
      tier_probs: JSON.parse(r.tierProbs),
      rule_tags: JSON.parse(r.ruleTags),
      precursors: JSON.parse(r.precursors),
      tierProbs: undefined,
      ruleTags: undefined,
    })),
  });
}
