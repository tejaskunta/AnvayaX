import indiaGeo from "../lib/india.json";
import { siteCoords } from "@/lib/siteCoords";

/* Static India silhouette with one dot per monitored site — a presentation
 * anchor for the demo, not an interactive map. The outline is a vendored
 * Natural Earth polygon (lib/india.json) projected at render with a plain
 * equirectangular transform; no tiles, no map library, no client JS. Most
 * sites sit within ~15 km of each other in Upper Assam, so dots are fanned
 * out around the cluster centre to stay readable — positions are schematic,
 * but colour (density band) and size (report volume) are real. */

type Ring = [number, number][];

const W = 150;
const PAD = 6;

function ringsOf(geom: { type: string; coordinates: unknown }): Ring[] {
  if (geom.type === "Polygon") return geom.coordinates as Ring[];
  if (geom.type === "MultiPolygon") return (geom.coordinates as Ring[][]).flat();
  return [];
}

const RINGS = (
  indiaGeo as unknown as { features: { geometry: { type: string; coordinates: unknown } }[] }
).features.flatMap((f) => ringsOf(f.geometry));

const PTS = RINGS.flat();
const MIN_LNG = Math.min(...PTS.map((p) => p[0]));
const MAX_LNG = Math.max(...PTS.map((p) => p[0]));
const MIN_LAT = Math.min(...PTS.map((p) => p[1]));
const MAX_LAT = Math.max(...PTS.map((p) => p[1]));
const H = Math.round(((MAX_LAT - MIN_LAT) / (MAX_LNG - MIN_LNG)) * (W - PAD * 2)) + PAD * 2;

function project(lng: number, lat: number): [number, number] {
  return [
    PAD + ((lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * (W - PAD * 2),
    PAD + ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * (H - PAD * 2),
  ];
}

const OUTLINE = RINGS.map(
  (r) =>
    "M" +
    r.map(([lng, lat]) => {
      const [x, y] = project(lng, lat);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join("L") +
    "Z"
).join("");

/* Same score-banded ladder as the heatmap bars (kept local so this stays a
 * server component — Heatmap.tsx is client-only). */
function densityColor(d: number) {
  if (d >= 55) return "var(--risk-dark)";
  if (d >= 45) return "var(--risk-red)";
  if (d >= 30) return "var(--risk-amber)";
  if (d >= 20) return "var(--tier-rec)";
  return "var(--tier-nm)";
}

const FAN = 1.7;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* At country scale the Assam sites collapse into ~1px, so a linear fan is
 * not enough. Relax the dots apart with a few repulsion passes (seeded from
 * the fanned positions, so relative geography — east/west, north/south — is
 * preserved), then clamp back inside the outline. Deterministic: same
 * sites in, same picture out. */
function separate(pts: [number, number][], minDist: number, lo: [number, number], hi: [number, number]): [number, number][] {
  const p = pts.map(([x, y]) => [x, y]) as [number, number][];
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j][0] - p[i][0];
        const dy = p[j][1] - p[i][1];
        const d = Math.hypot(dx, dy);
        if (d < 1e-6 || d >= minDist) continue;
        const push = (minDist - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        p[i][0] -= ux * push; p[i][1] -= uy * push;
        p[j][0] += ux * push; p[j][1] += uy * push;
      }
    }
    for (const q of p) {
      q[0] = clamp(q[0], lo[0], hi[0]);
      q[1] = clamp(q[1], lo[1], hi[1]);
    }
  }
  return p;
}

type SiteRow = {
  name: string;
  region: string;
  totalReports: number;
  density: number;
};

export default function IndiaSpots({ sites }: { sites: SiteRow[] }) {
  const dots = sites.map((s) => {
    const c = siteCoords(s.name);
    return { ...s, xy: project(c.lng, c.lat) };
  });
  const cx = dots.reduce((a, d) => a + d.xy[0], 0) / Math.max(1, dots.length);
  const cy = dots.reduce((a, d) => a + d.xy[1], 0) / Math.max(1, dots.length);
  const maxReports = Math.max(1, ...dots.map((d) => d.totalReports));
  const radii = dots.map((d) => 2 + Math.sqrt(d.totalReports / maxReports) * 3);
  const fanned = dots.map((d) => [
    clamp(cx + (d.xy[0] - cx) * FAN, PAD + 3, W - PAD - 3),
    clamp(cy + (d.xy[1] - cy) * FAN, PAD + 3, H - PAD - 3),
  ]) as [number, number][];
  const placed = separate(
    fanned,
    Math.max(...radii) * 2 + 1.5,
    [PAD + 3, PAD + 3],
    [W - PAD - 3, H - PAD - 3]
  );

  return (
    <aside aria-label="Site locations across India" className="panel p-3">
      <p className="label-micro">Field network</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Outline of India with ${dots.length} monitored sites, clustered in Assam`}
        className="mt-1.5 block"
      >
        <path
          d={OUTLINE}
          style={{ fill: "var(--ink-850)", stroke: "var(--line-strong)", strokeWidth: 0.8 }}
        />
        {dots.map((d, i) => (
          <circle
            key={d.name}
            cx={placed[i][0].toFixed(1)}
            cy={placed[i][1].toFixed(1)}
            r={radii[i].toFixed(1)}
            fill={densityColor(d.density)}
            stroke="var(--ink-900)"
            strokeWidth={1}
          >
            <title>{`${d.name} — ${d.density.toFixed(1)} SIF-potential/100 · ${d.totalReports} reports`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1.5 text-xs text-[var(--faint)]">
        <span className="num">{dots.length}</span> sites · size = report volume
      </p>
    </aside>
  );
}
