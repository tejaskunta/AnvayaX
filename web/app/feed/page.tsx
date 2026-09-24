"use client";

/* Screen 5 — filterable report feed. Source-layer badges are explicit
 * (synthetic rows are labelled, never hidden) and SIF-positive rows carry
 * the severity ladder. */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import TierChip from "@/components/TierChip";
import SeverityBar from "@/components/Gauges";
import { TIER_ORDER, SOURCE_LABEL, TIER_LABEL, fmtNum } from "@/lib/ui";

type FeedRow = {
  id: string;
  tier: string;
  site: string;
  activity: string | null;
  severityIndex: number;
  confidence: number;
  occurredAt: string | null;
  sourceLayer: string;
  needsReview: number;
  acquisitionScore: number;
  modelVersion: string;
  excerpt: string;
};

const PAGE = 25;

export default function Feed() {
  const [tier, setTier] = useState("");
  const [site, setSite] = useState("");
  const [layer, setLayer] = useState("");
  const [review, setReview] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<{ total: number; reports: FeedRow[] } | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sites/heatmap", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSites((j.sites ?? []).map((s: { name: string }) => s.name)))
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    if (tier) sp.set("tier", tier);
    if (site) sp.set("site", site);
    if (layer) sp.set("layer", layer);
    if (review) sp.set("review", "1");
    if (query) sp.set("q", query);
    sp.set("limit", String(PAGE));
    sp.set("offset", String(offset));
    fetch(`/api/reports?${sp}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`reports -> ${r.status}`);
        return r.json();
      })
      .then((j) => setData(j))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [tier, site, layer, review, query, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = () => {
    setOffset(0);
    setQuery(q.trim());
  };

  const total = data?.total ?? 0;
  const pages = useMemo(() => Math.max(1, Math.ceil(total / PAGE)), [total]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Report feed</h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Every classified report, newest verdict first.{" "}
            <span className="num">{fmtNum(total)}</span> matching.
          </p>
        </div>
        <Link href="/sandbox" className="btn-ghost">
          analyze one now →
        </Link>
      </header>

      <section className="panel mt-5 flex flex-wrap items-center gap-2 p-3" aria-label="Filters">
        <div className="flex overflow-hidden rounded-[3px] border border-[var(--line-strong)]" role="group" aria-label="Tier filter">
          <button
            type="button"
            onClick={() => { setTier(""); setOffset(0); }}
            aria-pressed={!tier}
            className={`px-2.5 py-1 text-xs ${!tier ? "bg-[var(--ink-800)] text-[var(--chalk)]" : "text-[var(--faint)] hover:text-[var(--dim)]"}`}
          >
            All tiers
          </button>
          {TIER_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTier(t); setOffset(0); }}
              aria-pressed={tier === t}
              className={`border-l border-[var(--line-strong)] px-2.5 py-1 text-xs ${
                tier === t ? "bg-[var(--ink-800)] font-semibold text-[var(--chalk)]" : "text-[var(--faint)] hover:text-[var(--dim)]"
              }`}
              style={tier === t ? { color: `var(--tier-${t === "near_miss" ? "nm" : t === "recordable" ? "rec" : t})` } : undefined}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>

        <select className="field !w-auto py-1 text-xs" value={site} aria-label="Site filter" onChange={(e) => { setSite(e.target.value); setOffset(0); }}>
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select className="field !w-auto py-1 text-xs" value={layer} aria-label="Source filter" onChange={(e) => { setLayer(e.target.value); setOffset(0); }}>
          <option value="">All sources</option>
          <option value="l3_synthetic">synthetic gold</option>
          <option value="l2_domain">domain corpus</option>
          <option value="manual">sandbox</option>
          <option value="upload">upload</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-[var(--dim)]">
          <input type="checkbox" checked={review} onChange={(e) => { setReview(e.target.checked); setOffset(0); }} className="accent-[var(--tier-rec)]" />
          needs review
        </label>

        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); applySearch(); }}
        >
          <input
            className="field !w-52 py-1 text-xs"
            placeholder="search text or id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search reports"
          />
          <button type="submit" className="btn !py-1 text-xs">Search</button>
        </form>
      </section>

      {error && (
        <p className="panel mt-4 border-[var(--tier-asif)] p-3 text-sm text-[var(--tier-asif)]">
          {error} — is the Next.js server running with the database seeded?
        </p>
      )}

      <ul className="mt-4 space-y-px overflow-hidden rounded-[3px] border border-[var(--line)]" aria-live="polite">
        {loading && !data && (
          <li className="bg-[var(--ink-900)] px-4 py-10 text-center text-sm text-[var(--faint)]">loading…</li>
        )}
        {data?.reports.map((r) => (
          <li key={r.id} className={`bg-[var(--ink-900)] px-4 py-3 ${loading ? "opacity-60" : ""} transition-opacity`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TierChip tier={r.tier} />
              <span className="num text-xs text-[var(--faint)]">{r.id}</span>
              <span
                className="rounded-[2px] border border-[var(--line-strong)] px-1.5 py-0.5 text-[10px] text-[var(--dim)]"
                title={`source layer: ${r.sourceLayer}`}
              >
                {SOURCE_LABEL[r.sourceLayer] ?? r.sourceLayer}
                {r.sourceLayer === "l3_synthetic" ? " · synthetic" : ""}
              </span>
              {r.needsReview === 1 && (
                <span className="rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: "var(--tier-rec)", background: "color-mix(in srgb, var(--tier-rec) 12%, transparent)" }}>
                  needs review
                </span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <SeverityBar value={r.severityIndex} tier={r.tier} width={80} />
                <span className="num hidden w-14 text-right text-xs text-[var(--faint)] sm:inline" title="model confidence">
                  {(r.confidence * 100).toFixed(0)}%
                </span>
              </span>
            </div>
            <Link href={`/report/${r.id}`} className="mt-1.5 block">
              <p className="line-clamp-2 text-[13px] leading-5 text-[var(--dim)] hover:text-[var(--chalk)]">
                {r.excerpt}
                {r.excerpt.length >= 240 ? "…" : ""}
              </p>
            </Link>
            <p className="mt-1 text-[11px] text-[var(--faint)]">
              <Link href={`/site/${encodeURIComponent(r.site)}`} className="hover:text-[var(--dim)]">
                {r.site}
              </Link>
              {r.activity ? ` · ${r.activity}` : ""} · {r.occurredAt ?? "date unknown"} · {r.modelVersion}
            </p>
          </li>
        ))}
        {data && !data.reports.length && !loading && (
          <li className="bg-[var(--ink-900)] px-4 py-10 text-center text-sm text-[var(--faint)]">
            Nothing matches these filters. Clear one of them, or ingest new reports.
          </li>
        )}
      </ul>

      {total > PAGE && (
        <nav className="mt-4 flex items-center justify-between text-xs text-[var(--dim)]" aria-label="Pagination">
          <button type="button" className="btn !py-1 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ← previous
          </button>
          <span className="num">
            page {Math.floor(offset / PAGE) + 1} / {pages}
          </span>
          <button type="button" className="btn !py-1 text-xs" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            next →
          </button>
        </nav>
      )}
    </div>
  );
}
