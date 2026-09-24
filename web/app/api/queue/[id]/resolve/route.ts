/* POST /api/queue/[id]/resolve — reviewer accepts or corrects a queued report.
 * body: { action: "accept" | "correct", corrected_tag?, corrected_by? }
 * Writes a corrections row (the training signal) and, on "correct", updates
 * the report's tier so aggregates stay truthful. released_to_pool flips to 1
 * when scripts/export_corrections.ts ships the row to the next /train call. */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, reports } from "@/db/schema";
import { recomputeSites, TIER_ORDER } from "@/lib/aggregates";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "accept" && action !== "correct") {
    return NextResponse.json({ error: 'action must be "accept" or "correct"' }, { status: 400 });
  }
  const correctedTag =
    action === "accept" ? undefined : String(body?.corrected_tag ?? "");
  if (action === "correct" && !TIER_ORDER.includes(correctedTag as (typeof TIER_ORDER)[number])) {
    return NextResponse.json(
      { error: `corrected_tag must be one of ${TIER_ORDER.join(", ")}` },
      { status: 400 }
    );
  }

  const db = getDb();
  const report = db.select().from(reports).where(eq(reports.id, id)).all()[0];
  if (!report) return NextResponse.json({ error: `unknown report: ${id}` }, { status: 404 });

  const already = db.select().from(corrections).where(eq(corrections.reportId, id)).all()[0];
  if (already) {
    return NextResponse.json({ error: "already resolved", correction: already }, { status: 409 });
  }

  const finalTag = action === "accept" ? report.tier : correctedTag!;
  const row = db
    .insert(corrections)
    .values({
      reportId: id,
      originalTag: report.tier,
      correctedTag: finalTag,
      action,
      correctedBy: String(body?.corrected_by ?? "reviewer"),
      releasedToPool: 0,
    })
    .returning()
    .all()[0];

  if (action === "correct" && finalTag !== report.tier) {
    db.update(reports)
      .set({ tier: finalTag, needsReview: 0 })
      .where(eq(reports.id, id))
      .run();
    recomputeSites(db);
  } else {
    db.update(reports).set({ needsReview: 0 }).where(eq(reports.id, id)).run();
  }

  return NextResponse.json({ ok: true, correction: row, report_tier: finalTag });
}
