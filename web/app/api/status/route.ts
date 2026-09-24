/* GET /api/status — tiny health ping for the shell chrome (service state +
 * live queue count). Never fails: offline service degrades, never 500s. */
import { NextResponse } from "next/server";
import { and, or, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { corrections, reports } from "@/db/schema";
import { mlApi } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let service = { status: "offline", mode: "unreachable", active_version: "—" };
  try {
    const h = await mlApi.health();
    service = { status: h.status, mode: h.mode, active_version: h.active_version };
  } catch {
    /* ml-service down — shell shows the red dot */
  }

  const db = getDb();
  const resolved = sql`exists (select 1 from ${corrections} where ${corrections.reportId} = ${reports.id})`;
  const queueTotal = db
    .select({ n: sql<number>`count(*)` })
    .from(reports)
    .where(and(or(eq(reports.needsReview, 1), sql`${reports.acquisitionScore} >= 0.55`), sql`not ${resolved}`))
    .all()[0].n;

  return NextResponse.json({ ...service, queue_total: queueTotal });
}
