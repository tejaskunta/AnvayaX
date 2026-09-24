/* POST /api/refresh — trigger the continual-learning refresh from the UI
 * (demo path for the scheduled job; see docs/cron.md for the cron variant).
 * Spawns scripts/refresh.ts which: assembles the gold pool, trains a LoRA
 * challenger, runs the frozen-gate champion/challenger comparison, and on
 * promotion re-classifies the corpus + mirrors the registry. */
import { spawn } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 3600; // LoRA refresh takes minutes

let running: Promise<void> | null = null;

export async function POST() {
  if (running) {
    return NextResponse.json({ ok: false, error: "A refresh is already running." }, { status: 409 });
  }
  const webRoot = process.cwd();
  const tsx = path.join(webRoot, "node_modules", ".bin", "tsx");
  const script = path.join(webRoot, "scripts", "refresh.ts");

  const done = new Promise<void>((resolve) => {
    const child = spawn(tsx, [script], { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => console.log(`[refresh] ${String(d).trimEnd()}`));
    child.stderr.on("data", (d) => console.error(`[refresh] ${String(d).trimEnd()}`));
    child.on("close", (code) => {
      console.log(`[refresh] exit ${code}`);
      running = null;
      resolve();
    });
    child.on("error", (e) => {
      console.error("[refresh] spawn failed", e);
      running = null;
      resolve();
    });
  });
  running = done;

  return NextResponse.json({
    ok: true,
    started: true,
    note: "Refresh running in background — watch /api/model-insight registry for the new version. This takes several minutes.",
  });
}

export async function GET() {
  return NextResponse.json({ running: running !== null });
}
