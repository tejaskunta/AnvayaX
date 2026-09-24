/* GET /api/reports — filterable report list (?tier=&site=&q=&layer=&review=1&limit=&offset=). */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { reports } from "@/db/schema";
import { TIER_ORDER } from "@/lib/aggregates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const db = getDb();
  const conds = [];
  const tier = sp.get("tier");
  if (tier && TIER_ORDER.includes(tier as (typeof TIER_ORDER)[number])) conds.push(eq(reports.tier, tier));
  const site = sp.get("site");
  if (site) conds.push(eq(reports.site, site));
  const layer = sp.get("layer");
  if (layer) conds.push(eq(reports.sourceLayer, layer));
  if (sp.get("review") === "1") conds.push(eq(reports.needsReview, 1));
  const q = sp.get("q")?.trim();
  if (q) conds.push(or(like(reports.rawText, `%${q}%`), like(reports.id, `%${q}%`)));

  const limit = Math.min(Number(sp.get("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);
  const where = conds.length ? and(...conds) : undefined;

  const rows = db
    .select({
      id: reports.id,
      tier: reports.tier,
      site: reports.site,
      activity: reports.activity,
      severityIndex: reports.severityIndex,
      confidence: reports.confidence,
      occurredAt: reports.occurredAt,
      sourceLayer: reports.sourceLayer,
      needsReview: reports.needsReview,
      acquisitionScore: reports.acquisitionScore,
      modelVersion: reports.modelVersion,
      excerpt: sql<string>`substr(${reports.rawText}, 1, 240)`,
    })
    .from(reports)
    .where(where)
    .orderBy(desc(reports.severityIndex))
    .limit(limit)
    .offset(offset)
    .all();
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(reports)
    .where(where)
    .all()[0].n;

  return NextResponse.json({ total, limit, offset, reports: rows });
}
