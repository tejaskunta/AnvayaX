"use client";

/* Manual trigger for the continual-learning refresh (demo path for the
 * scheduled job). POST /api/refresh spawns scripts/refresh.ts in the
 * background; we poll /api/model-insight's registry until a new version
 * appears, then reload the page to render it. */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function RefreshButton({ running: initialRunning = false }: { running?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(initialRunning);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    setMsg("capturing current champion…");
    try {
      const before = await fetch("/api/model-insight", { cache: "no-store" }).then((r) => r.json());
      const currentChampion: string | null =
        (before.registry ?? []).find((r: { promoted_at: string | null }) => r.promoted_at)?.version ?? null;
      baseline.current = currentChampion;

      setMsg("launching refresh — LoRA training takes a few minutes");
      const res = await fetch("/api/refresh", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `refresh -> ${res.status}`);

      let elapsed = 0;
      timer.current = setInterval(async () => {
        elapsed += 20;
        setMsg(`training challenger + running frozen gate… ${Math.floor(elapsed / 6)}s`);
        try {
          const after = await fetch("/api/model-insight", { cache: "no-store" }).then((r) => r.json());
          const champ: string | null =
            (after.registry ?? []).find((r: { promoted_at: string | null }) => r.promoted_at)?.version ?? null;
          const versions: string[] = (after.registry ?? []).map((r: { version: string }) => r.version);
          const newVersion = versions.find((v) => v !== baseline.current && v !== champ);
          if (champ && champ !== baseline.current) {
            setMsg(`promoted: ${baseline.current} → ${champ}`);
            if (timer.current) clearInterval(timer.current);
            setTimeout(() => router.refresh(), 1500);
          } else if (newVersion) {
            // A challenger appeared but champion unchanged → gate rejected it.
            const row = after.registry.find((r: { version: string }) => r.version === newVersion);
            setMsg(`${newVersion} ${row?.gate_result ?? "gated"} — champion kept`);
            if (timer.current) clearInterval(timer.current);
            setTimeout(() => router.refresh(), 2500);
          }
        } catch {
          /* insight route transiently busy — keep polling */
        }
      }, 20000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setMsg(null);
      if (timer.current) clearInterval(timer.current);
    }
  };

  return (
    <div className="text-right">
      <button type="button" className="btn-primary" onClick={start} disabled={busy}>
        {busy ? (
          <>
            <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--on-accent)]" aria-hidden />
            refresh running
          </>
        ) : (
          "Run refresh now"
        )}
      </button>
      <p className="mt-1.5 max-w-60 text-xs leading-4 text-[var(--faint)]">
        {error ? (
          <span className="text-[var(--tier-asif)]">{error}</span>
        ) : msg ? (
          msg
        ) : (
          "Trains a LoRA challenger on the gold pool and runs the frozen gate. Same job the cron runs every 7 days."
        )}
      </p>
    </div>
  );
}
