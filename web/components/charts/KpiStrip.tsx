/* Chart 1 — KPI strip. Flat stat blocks (no card), matching the home-page
 * KPI doctrine. Every value is computed server-side; recall is withheld when
 * fewer than 30 reports have been reviewed rather than shown as a fake number. */
import Link from "next/link";

import { fmtNum, fmtPct } from "@/lib/ui";
import type { KpiStripData } from "@/db/queries/overview";

type Props = { data: KpiStripData; site: string | null };

function feedHref(site: string | null, extra: string): string {
  const sp = new URLSearchParams();
  if (site) sp.set("site", site);
  const [k, v] = extra.split("=");
  if (v) sp.set(k, v);
  const q = sp.toString();
  return q ? `/feed?${q}` : "/feed";
}

export default function KpiStrip({ data, site }: Props) {
  const items = [
    {
      label: "Reports ingested",
      value: fmtNum(data.total),
      sub: data.total < 20 ? "small sample — counts only" : "in selected window",
      href: feedHref(site, ""),
      color: "var(--line-strong)",
    },
    {
      label: "aSIF + pSIF share",
      value: data.sifShare === null ? "—" : data.total < 20 ? `${fmtNum(data.sifCount)} of ${fmtNum(data.total)}` : fmtPct(data.sifShare, 0),
      sub: `${fmtNum(data.sifCount)} SIF-potential reports`,
      href: feedHref(site, "tier=psif"),
      color: "var(--tier-psif)",
    },
    {
      label: "Escalating site × rule",
      value: fmtNum(data.escalatingPairs),
      sub: data.worstPair ? `worst: ${data.worstPair}` : "no breach this window",
      href: feedHref(site, ""),
      color: data.escalatingPairs > 0 ? "var(--tier-asif)" : "var(--line-strong)",
    },
    {
      label: "Model recall (SIF)",
      value: data.recall === null ? "—" : fmtPct(data.recall, 0),
      sub: data.recallNote ?? `${fmtNum(data.reviewedCount)} reviewed reports`,
      href: "/model",
      color: "var(--brand)",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4" aria-label="Portfolio key numbers">
      {items.map((k) => (
        <div key={k.label} className="border-t-2 pt-2.5" style={{ borderColor: k.color }}>
          <p className="label-micro">{k.label}</p>
          <p className="num mt-1 text-[26px] font-semibold leading-none" style={k.color.startsWith("var(--t") || k.color === "var(--brand)" ? { color: k.color } : undefined}>
            <Link href={k.href} className="hover:underline">
              {k.value}
            </Link>
          </p>
          <p className="mt-1.5 text-xs text-[var(--faint)]">{k.sub}</p>
        </div>
      ))}
    </div>
  );
}
