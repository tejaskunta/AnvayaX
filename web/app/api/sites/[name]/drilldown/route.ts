/* GET /api/sites/[name]/drilldown — per-site breakdown: tier mix, monthly
 * trend, top activities, and the highest-severity recent reports. */
import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { reports, sites } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const name = decodeURIComponent(params.name);
  const db = getDb();
  const site = db.select().from(sites).where(eq(sites.name, name)).all()[0];
  if (!site) return NextResponse.json({ error: `unknown site: ${name}` }, { status: 404 });

  const rs = db
    .select({
      id: reports.id,
      tier: reports.tier,
      activity: reports.activity,
      severityIndex: reports.severityIndex,
      occurredAt: reports.occurredAt,
      confidence: reports.confidence,
      rawText: reports.rawText,
      needsReview: reports.needsReview,
    })
    .from(reports)
    .where(eq(reports.site, name))
    .all();

  const tierMix: Record<string, number> = { near_miss: 0, recordable: 0, psif: 0, asif: 0 };
  const byMonth = new Map<string, { total: number; sif: number }>();
  const byActivity = new Map<string, { total: number; sif: number }>();
  for (const r of rs) {
    tierMix[r.tier] = (tierMix[r.tier] ?? 0) + 1;
    const month = r.occurredAt ? r.occurredAt.slice(0, 7) : "unknown";
    const isSif = r.tier === "psif" || r.tier === "asif";
    const m = byMonth.get(month) ?? { total: 0, sif: 0 };
    m.total++;
    m.sif += isSif ? 1 : 0;
    byMonth.set(month, m);
    const act = r.activity || "Unspecified";
    const a = byActivity.get(act) ?? { total: 0, sif: 0 };
    a.total++;
    a.sif += isSif ? 1 : 0;
    byActivity.set(act, a);
  }

  const monthly = [...byMonth.entries()]
    .filter(([k]) => k !== "unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      total: v.total,
      sif: v.sif,
      density: Math.round((v.sif / v.total) * 1000) / 10,
    }));

  const activities = [...byActivity.entries()]
    .map(([activity, v]) => ({
      activity,
      total: v.total,
      sif: v.sif,
      density: Math.round((v.sif / v.total) * 1000) / 10,
    }))
    .sort((a, b) => b.sif - a.sif || b.total - a.total)
    .slice(0, 8);

  const worst = [...rs]
    .sort((a, b) => b.severityIndex - a.severityIndex)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      tier: r.tier,
      activity: r.activity,
      severity_index: r.severityIndex,
      occurred_at: r.occurredAt,
      confidence: Math.round(r.confidence * 100) / 100,
      needs_review: !!r.needsReview,
      excerpt: r.rawText.slice(0, 200),
    }));

  return NextResponse.json({ site, tier_mix: tierMix, monthly, activities, worst });
}
