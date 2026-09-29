import "server-only";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

/*
 * Two deployment targets share this module:
 *
 *  1. Local dev — the mutable demo DB lives at db/sqlite.db (or $DATABASE_URL)
 *     and is written by the seed / ingest / refresh scripts.
 *  2. Vercel (serverless) — the filesystem is read-only outside /tmp, so a
 *     bundled snapshot of the demo corpus (db/snapshot.db, committed) is copied
 *     into the instance-local /tmp on first use and opened there. Every
 *     existing SELECT/INSERT/UPDATE keeps working unchanged; only the file
 *     location moves. Writes stay within a single warm instance and reset on
 *     cold start — acceptable for a read-mostly demo, not for durable state.
 *
 * $DATABASE_URL still wins if you point it at a real (writable) path, e.g. a
 * mounted volume, in which case the snapshot copy is skipped entirely.
 */

const projectRoot = process.cwd();

/** Where the demo corpus is read from when no writable DATABASE_URL is set. */
const SNAPSHOT_PATH = path.join(projectRoot, "db", "snapshot.db");
/** Instance-local working copy used on read-only serverless filesystems. */
const TMP_DB_PATH = path.join(
  process.env.ANVAYA_TMP_DIR ?? "/tmp",
  "anvayax",
  // Keyed per deployment so a new snapshot never reads a stale /tmp copy.
  // VERCEL_DEPLOYMENT_ID is set at runtime (VERCEL_GIT_COMMIT_SHA is build-
  // time only, so it would be undefined here); falls back to "dev" locally.
  process.env.VERCEL_DEPLOYMENT_ID ?? "dev",
  "sqlite.db"
);

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

/**
 * Resolve the SQLite file to open. On Vercel we materialise the committed
 * snapshot into /tmp (idempotent, cheap) so better-sqlite3 has a writable
 * location; locally we open the real working DB directly.
 */
function resolveDbPath(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  if (isVercelRuntime()) {
    try {
      if (!fs.existsSync(TMP_DB_PATH)) {
        fs.mkdirSync(path.dirname(TMP_DB_PATH), { recursive: true });
        // Prefer the committed snapshot; fall back to the dev DB if present.
        const source = fs.existsSync(SNAPSHOT_PATH)
          ? SNAPSHOT_PATH
          : path.join(projectRoot, "db", "sqlite.db");
        if (fs.existsSync(source)) fs.copyFileSync(source, TMP_DB_PATH);
      }
    } catch {
      /* copy failed — fall through and try to open the snapshot read-only */
    }
    return fs.existsSync(TMP_DB_PATH) ? TMP_DB_PATH : SNAPSHOT_PATH;
  }

  return path.join(projectRoot, "db", "sqlite.db");
}

export const DB_PATH = resolveDbPath();

let _db: BetterSQLite3Database<typeof schema> | null = null;

/** Single shared connection (better-sqlite3 is synchronous; one file DB). */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    } catch {
      /* already exists, or read-only FS serving the bundled snapshot in
       * place — neither is fatal for opening the DB */
    }
    const sqlite = new Database(DB_PATH);
    try {
      // WAL needs to create -wal/-shm; fails if we opened the snapshot
      // read-only on a fallback path. Journal mode is a performance nicety.
      sqlite.pragma("journal_mode = WAL");
    } catch {
      /* keep the default journal */
    }
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export type DB = BetterSQLite3Database<typeof schema>;
