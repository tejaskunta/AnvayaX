/* Export reviewer decisions as gold training rows for the next refresh.
 * Writes ml-service/labeling/corrections_export.csv (id,text,tier) and flips
 * released_to_pool=1 so the audit trail shows what shipped. refresh.ts also
 * reads corrections live, so this is the "hand the labelers' work to the
 * training pipeline" artifact the PRD calls for.
 * Usage: cd web && node_modules/.bin/tsx scripts/export_corrections.ts */
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import { corrections, reports } from "../db/schema";

const DB_PATH = process.env.DATABASE_URL ?? path.join(process.cwd(), "db", "sqlite.db");
const OUT = path.resolve(process.cwd(), "..", "ml-service", "labeling", "corrections_export.csv");

const sqlite = new Database(DB_PATH);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const rows = db.select().from(corrections).all();
const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lines = ["id,text,tier,source"];
let exported = 0;
for (const c of rows) {
  const rep = db.select().from(reports).where(eq(reports.id, c.reportId)).all()[0];
  if (!rep) continue;
  lines.push(`${c.reportId},${esc(rep.rawText)},${c.correctedTag},reviewer_correction`);
  if (!c.releasedToPool) {
    db.update(corrections).set({ releasedToPool: 1 }).where(eq(corrections.id, c.id)).run();
  }
  exported++;
}
fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`exported ${exported} correction(s) -> ${OUT}`);
sqlite.close();
