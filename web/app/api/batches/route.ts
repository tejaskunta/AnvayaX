/* GET /api/batches — recent ingestion batches (audit sidebar on /ingest). */
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { batches } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const rows = db.select().from(batches).orderBy(desc(batches.createdAt)).limit(12).all();
  return NextResponse.json({
    batches: rows.map((b) => ({
      id: b.id,
      filename: b.filename,
      rowCount: b.rowCount,
      insertedCount: b.insertedCount,
      skippedDuplicates: b.skippedDuplicates,
      source: b.source,
      createdAt: b.createdAt,
    })),
  });
}
