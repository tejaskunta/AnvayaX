/* POST /api/refresh — trigger the continual-learning refresh from the UI
 * (demo path for the scheduled job; see docs/cron.md for the cron variant).
 * Spawns scripts/refresh.ts which: assembles the gold pool, trains a LoRA
 * challenger, runs the frozen-gate champion/challenger comparison, and on
 * promotion re-classifies the corpus + mirrors the registry.
 *
 * Serverless (Vercel) note: spawning a minutes-long child process is
 * impossible in a request handler — the instance is frozen/killed the moment
 * the response returns and there is no local model/DB to train against. On
 * Vercel this endpoint answers 501 and points at the local/cron path instead. */
import { spawn } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
// LoRA refresh itself is disabled on Vercel (below); locally maxDuration is
// ignored. 60s is the ceiling that keeps a Hobby-plan deploy from failing.
export const maxDuration = 60;

let running: Promise<void> | null = null;

export async function POST() {
  if (process.env.VERCEL === "1") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Continual-learning refresh runs on the local worker, not in the hosted demo. " +
          "Run `cd web && npx tsx scripts/refresh.ts` (or the cron in docs/cron.md) against the same DB.",
      },
      { status: 501 }
    );
  }
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
