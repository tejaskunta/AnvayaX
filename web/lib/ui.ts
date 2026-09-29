/* Client-safe UI constants + formatters (no server-only imports). */
import type { CSSProperties } from "react";

export const TIER_ORDER = ["near_miss", "recordable", "psif", "asif"] as const;
export type Tier = (typeof TIER_ORDER)[number];

export const TIER_LABEL: Record<string, string> = {
  near_miss: "Near miss",
  recordable: "Recordable",
  psif: "SIF-potential",
  asif: "Actual SIF",
};

export const TIER_COLOR: Record<string, string> = {
  near_miss: "var(--tier-nm)",
  recordable: "var(--tier-rec)",
  psif: "var(--tier-psif)",
  asif: "var(--tier-asif)",
};

/* Light-theme hexes mirroring the :root tokens above — for Recharts fills,
 * which resolve SVG paint attributes and cannot read a CSS var(). */
export const TIER_HEX: Record<string, string> = {
  near_miss: "#0f766e",
  recordable: "#a16207",
  psif: "#c2410c",
  asif: "#b91c1c",
};

export const LINE_HEX = {
  chalk: "#17222e",
  dim: "#44576b",
  faint: "#5b6f84",
  line: "#d6dce4",
  lineStrong: "#b9c4d0",
  brand: "#0e3a5d",
  accent: "#e0912b",
  panel: "#ffffff",
  ink850: "#f2f5f8",
} as const;

/** Tier chip: label + foreground + translucent background, all inline-safe. */
export function tierChipStyle(tier: string): CSSProperties {
  const c = TIER_COLOR[tier] ?? "var(--dim)";
  return { color: c, borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 12%, transparent)` };
}

export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtNum(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) {
    const hrs = Math.floor((Date.now() - t) / 3_600_000);
    if (hrs <= 0) return "just now";
    return `${hrs}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  return mo === 1 ? "1 month ago" : `${mo} months ago`;
}

export const SOURCE_LABEL: Record<string, string> = {
  l2_domain: "domain corpus",
  l3_synthetic: "synthetic gold",
  manual: "sandbox",
  upload: "upload",
};
