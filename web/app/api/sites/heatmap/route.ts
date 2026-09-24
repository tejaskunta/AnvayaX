/* GET /api/sites/heatmap — site aggregates for the map screen. */
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { sites } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const rows = db.select().from(sites).all();
  const totals = rows.reduce(
    (acc, s) => {
      acc.reports += s.totalReports;
      acc.sif += s.sifPositive;
      return acc;
    },
    { reports: 0, sif: 0 }
  );
  return NextResponse.json({
    sites: rows,
    totals: { ...totals, density: totals.reports ? Math.round((totals.sif / totals.reports) * 1000) / 10 : 0 },
  });
}
