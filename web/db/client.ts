import "server-only";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export const DB_PATH =
  process.env.DATABASE_URL ?? path.join(process.cwd(), "db", "sqlite.db");

let _db: BetterSQLite3Database<typeof schema> | null = null;

/** Single shared connection (better-sqlite3 is synchronous; one file DB). */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export type DB = BetterSQLite3Database<typeof schema>;
