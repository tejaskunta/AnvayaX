"use client";

/* Screen 5 — filterable report feed. Source-layer badges are explicit
 * (synthetic rows are labelled, never hidden) and SIF-positive rows carry
 * the severity ladder. URL params (?tier=&site=&rule=&barrier=&from=&to=…)
 * pre-apply the filters so Portfolio-overview click-throughs land on the
 * matching slice. */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

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
  return (
    <Suspense fallback={null}>
      <FeedInner />
    </Suspense>
  );
}

function FeedInner() {
  const params = useSearchParams();
  const router = useRouter();
  const init = useMemo(
    () => ({
      tier: params.get("tier") ?? "",
      site: params.get("site") ?? "",
      layer: params.get("layer") ?? "",
      rule: params.get("rule") ?? "",
      barrier: params.get("barrier") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      review: params.get("review") === "1",
      q: params.get("q") ?? "",
    }),
    // Only the arrival URL seeds the state; later edits live in the widgets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [tier, setTier] = useState(init.tier);
  const [site, setSite] = useState(init.site);
  const [layer, setLayer] = useState(init.layer);
  const [review, setReview] = useState(init.review);
  const [q, setQ] = useState(init.q);
  const [query, setQuery] = useState(init.q.trim());
  const [offset, setOffset] = useState(0);
  // Chart click-through filters: seeded from the URL, clearable via chips.
  const [rule, setRule] = useState(init.rule);
  const [barrier, setBarrier] = useState(init.barrier);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);

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
    if (rule) sp.set("rule", rule);
    if (barrier) sp.set("barrier", barrier);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
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
  }, [tier, site, layer, review, rule, barrier, from, to, query, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = () => {
    setOffset(0);
    setQuery(q.trim());
  };

  const hasThrough = Boolean(rule || barrier || from || to);
  const clearThrough = () => {
    setRule("");
    setBarrier("");
    setFrom("");
    setTo("");
    setOffset(0);
    router.replace("/feed", { scroll: false });
  };

  const total = data?.total ?? 0;
  const pages = useMemo(() => Math.max(1, Math.ceil(total / PAGE)), [total]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            Report <em>feed</em>
          </h1>
          <p className="mt-1 max-w-[75ch] text-sm text-[var(--dim)]">
            Every classified report, newest verdict first.{" "}
            <span className="num">{fmtNum(total)}</span> matching.
          </p>
        </div>
        <Link href="/sandbox" className="btn-ghost">
          Analyze one now
        </Link>
      </header>

      <section className="panel mt-5 p-3" aria-label="Filters">
        <div className="flex max-w-xl overflow-hidden rounded-[3px] border border-[var(--line-strong)]" role="group" aria-label="Tier filter">
          <button
            type="button"
            onClick={() => { setTier(""); setOffset(0); }}
            aria-pressed={!tier}
            title="All tiers"
            className={`min-w-0 flex-1 truncate px-2.5 py-1 text-center text-xs ${!tier ? "bg-[var(--ink-800)] text-[var(--chalk)]" : "text-[var(--faint)] hover:text-[var(--dim)]"}`}
          >
            All tiers
          </button>
          {TIER_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTier(t); setOffset(0); }}
              aria-pressed={tier === t}
              title={TIER_LABEL[t]}
              className={`min-w-0 flex-1 truncate border-l border-[var(--line-strong)] px-2.5 py-1 text-center text-xs ${
                tier === t ? "bg-[var(--ink-800)] font-semibold text-[var(--chalk)]" : "text-[var(--faint)] hover:text-[var(--dim)]"
              }`}
              style={tier === t ? { color: `var(--tier-${t === "near_miss" ? "nm" : t === "recordable" ? "rec" : t})` } : undefined}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">

        <select className="field w-auto py-1 text-xs" value={site} aria-label="Site filter" onChange={(e) => { setSite(e.target.value); setOffset(0); }}>
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select className="field w-auto py-1 text-xs" value={layer} aria-label="Source filter" onChange={(e) => { setLayer(e.target.value); setOffset(0); }}>
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
            className="field w-52 py-1 text-xs"
            placeholder="search text or id..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search reports"
          />
          <button type="submit" className="btn !py-1 text-xs">Search</button>
        </form>
        </div>
      </section>

      {hasThrough && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Filters from the overview">
          <span className="label-micro text-[var(--faint)]">from overview</span>
          {rule && <ThroughChip label={`rule · ${rule}`} onClear={() => { setRule(""); setOffset(0); }} />}
          {barrier && <ThroughChip label={`barrier · ${barrier}`} onClear={() => { setBarrier(""); setOffset(0); }} />}
          {(from || to) && (
            <ThroughChip
              label={`week · ${from || "?"} → ${to || "?"}`}
              onClear={() => { setFrom(""); setTo(""); setOffset(0); }}
            />
          )}
          <button type="button" onClick={clearThrough} className="btn-ghost !py-0.5 text-xs">
            clear all
          </button>
        </div>
      )}

      {error && (
        <p className="panel mt-4 border-[var(--tier-asif)] p-3 text-sm text-[var(--tier-asif)]">
          {error} — is the Next.js server running with the database seeded?
        </p>
      )}

      <ul className="panel mt-4 space-y-px overflow-hidden" aria-live="polite">
        {loading && !data && (
          <li className="px-4 py-10 text-center text-sm text-[var(--faint)]">loading...</li>
        )}
        {data?.reports.map((r) => (
          <li key={r.id} className={`px-4 py-3 ${loading ? "opacity-60" : ""} transition-opacity`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TierChip tier={r.tier} />
              <span className="num text-xs text-[var(--faint)]">{r.id}</span>
              <span
                className="rounded-[2px] border border-[var(--line-strong)] px-1.5 py-0.5 text-xs text-[var(--dim)]"
                title={`source layer: ${r.sourceLayer}`}
              >
                {SOURCE_LABEL[r.sourceLayer] ?? r.sourceLayer}
                {r.sourceLayer === "l3_synthetic" ? " · synthetic" : ""}
              </span>
              {r.needsReview === 1 && (
                <span className="rounded-[2px] px-1.5 py-0.5 text-xs font-semibold" style={{ color: "var(--tier-rec)", background: "color-mix(in srgb, var(--tier-rec) 12%, transparent)" }}>
                  needs review
                </span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <SeverityBar value={r.severityIndex} tier={r.tier} width={80} showValue={false} />
                <span className="rounded-[2px] border border-[var(--line)] px-2 py-1 text-right">
                  <span className="block text-[11px] leading-none text-[var(--faint)]">Score</span>
                  <span className="num mt-1 block text-xs leading-none text-[var(--dim)]">{r.severityIndex.toFixed(0)}</span>
                </span>
                <span className="rounded-[2px] border border-[var(--line)] px-2 py-1 text-right" title="model confidence">
                  <span className="block text-[11px] leading-none text-[var(--faint)]">Confidence</span>
                  <span className="num mt-1 block text-xs leading-none text-[var(--dim)]">{(r.confidence * 100).toFixed(0)}%</span>
                </span>
              </span>
            </div>
            <Link href={`/report/${r.id}`} className="mt-1.5 block">
              <p className="line-clamp-2 max-w-[58ch] text-[13px] leading-5 text-[var(--dim)] hover:text-[var(--chalk)]">
                {r.excerpt}
                {r.excerpt.length >= 240 ? "…" : ""}
              </p>
            </Link>
            <p className="mt-1 flex max-w-[58ch] flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--faint)]">
              <Link href={`/site/${encodeURIComponent(r.site)}`} className="hover:text-[var(--dim)]">
                {r.site}
              </Link>
              {r.activity && (
                <span
                  className="max-w-[24ch] truncate rounded-[2px] border border-[var(--line)] px-1.5 py-px text-xs text-[var(--dim)]"
                  title={r.activity}
                >
                  {r.activity}
                </span>
              )}
              <span>· {r.occurredAt ?? "date unknown"} · {r.modelVersion}</span>
            </p>
          </li>
        ))}
        {data && !data.reports.length && !loading && (
          <li className="px-4 py-10 text-center text-sm text-[var(--faint)]">
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

function ThroughChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[2px] border border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] py-0.5 pl-2 pr-1 text-[var(--brand)]">
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear filter ${label}`} className="rounded-full px-1 hover:bg-[color-mix(in_srgb,var(--brand)_15%,transparent)]">
        ×
      </button>
    </span>
  );
}
