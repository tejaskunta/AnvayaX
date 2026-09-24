/* GET /api/reports/[id] — full single report incl. raw text, rule tags,
 * precursors, tier probs, and any correction the reviewer logged. */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, reports } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const db = getDb();
  const row = db.select().from(reports).where(eq(reports.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: `unknown report: ${id}` }, { status: 404 });
  const correction = db.select().from(corrections).where(eq(corrections.reportId, id)).all()[0] ?? null;
  const { embedding, rawText, ...rest } = row;
  return NextResponse.json({
    ...rest,
    text: rawText,
    tier_probs: JSON.parse(row.tierProbs),
    rule_tags: JSON.parse(row.ruleTags),
    precursors: JSON.parse(row.precursors),
    correction,
  });
}
