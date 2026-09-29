"use client";

/* Screen 1 — bulk ingest. Drop a CSV/XLSX/JSON of incident reports; every
 * row is classified by the champion model and persisted. Duplicate ids are
 * skipped; the batch summary is the audit trail. */
import { useCallback, useEffect, useRef, useState } from "react";

import { fmtNum } from "@/lib/ui";

type BatchRow = {
  id: string;
  filename: string | null;
  rowCount: number;
  insertedCount: number;
  skippedDuplicates: number;
  source: string;
  createdAt: string;
};

type IngestSummary = {
  batchId: string;
  rowCount: number;
  inserted: number;
  skippedDuplicates: number;
  tiers: Record<string, number>;
  sifPotential: number;
  needsReview: number;
};

export default function Ingest() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [progress, setProgress] = useState("");
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(() => {
    fetch("/api/batches", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBatches(j.batches ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.(csv|xlsx?|json)$/i.test(f.name)) {
      setError("Unsupported file type — use .csv, .xlsx, or .json");
      return;
    }
    setError(null);
    setSummary(null);
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setProgress(`classifying ${file.name} — this runs the model over every row, allow a few minutes for large files`);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `ingest -> ${res.status}`);
      setSummary(j as IngestSummary);
      loadBatches();
      window.dispatchEvent(new Event("anvaya:queue"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <header>
        <h1 className="page-title">
          Ingest <em>reports</em>
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-[1.6] text-[var(--dim)]">
          Upload a batch of free-text HSSE reports. Required column:{" "}
          <code className="num rounded-md bg-[var(--ink-800)] px-1.5 py-0.5 text-xs">text</code>. Optional:{" "}
          <code className="num rounded-md bg-[var(--ink-800)] px-1.5 py-0.5 text-xs">id, site, activity, occurred_at</code>.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div
            className={`panel flex min-h-40 flex-col items-center justify-center border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-[var(--tier-nm)] bg-[var(--ink-850)]" : "border-[var(--line-strong)]"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
          >
            {file ? (
              <>
                <p className="num text-sm text-[var(--chalk)]">{file.name}</p>
                <p className="mt-1 text-xs text-[var(--faint)]">{(file.size / 1024).toFixed(0)} KB</p>
                <button type="button" className="btn mt-4" onClick={run} disabled={busy}>
                  {busy ? "classifying…" : "Classify & store"}
                </button>
                <button type="button" className="btn-ghost mt-2" onClick={() => setFile(null)} disabled={busy}>
                  choose another
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--dim)]">Drop a .csv, .xlsx, or .json file here</p>
                <button type="button" className="btn mt-3" onClick={() => inputRef.current?.click()}>
                  browse files
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.json"
                  className="hidden"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </>
            )}
          </div>

          {busy && (
            <p className="mt-3 flex items-center gap-2 text-xs text-[var(--dim)]" role="status">
              <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--tier-nm)]" aria-hidden />
              {progress}
            </p>
          )}
          {error && (
            <p className="panel mt-3 border-[var(--tier-asif)] p-3 text-sm text-[var(--tier-asif)]" role="alert">
              {error}
            </p>
          )}

          {summary && (
            <section className="panel mt-4 p-4" aria-label="Ingest summary">
              <p className="font-display text-sm font-semibold text-[var(--tier-nm)]">
                Ingested {summary.inserted} of {summary.rowCount} rows
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Stored" value={fmtNum(summary.inserted)} />
                <Stat label="Duplicate ids skipped" value={fmtNum(summary.skippedDuplicates)} />
                <Stat label="SIF-potential" value={fmtNum(summary.sifPotential)} color="var(--tier-psif)" />
                <Stat label="Sent to review queue" value={fmtNum(summary.needsReview)} color="var(--tier-rec)" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(summary.tiers).map(([tier, n]) => (
                  <span key={tier} className="num rounded-[2px] border border-[var(--line-strong)] px-2 py-0.5 text-xs text-[var(--dim)]">
                    {tier.replace("_", " ")} × {n}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--faint)]">
                Batch <span className="num">{summary.batchId}</span> recorded in the audit trail.
              </p>
            </section>
          )}
        </div>

        <aside className="panel p-4" aria-label="Recent batches">
          <h2 className="font-display text-sm font-semibold text-[var(--chalk)]">
            Recent batches
          </h2>
          <ul className="mt-3 space-y-3">
            {batches.map((b) => (
              <li key={b.id} className="text-xs">
                <p className="truncate text-[var(--chalk)]">{b.filename ?? b.id}</p>
                <p className="num mt-0.5 text-xs text-[var(--faint)]">
                  {fmtNum(b.insertedCount)} stored · {fmtNum(b.skippedDuplicates)} dupes · {b.source} ·{" "}
                  {new Date(b.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </p>
              </li>
            ))}
            {!batches.length && <li className="text-xs text-[var(--faint)]">No batches yet.</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="label-micro">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}
