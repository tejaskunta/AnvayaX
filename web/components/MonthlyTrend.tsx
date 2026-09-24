"use client";

/* Monthly SIF-density trend for the drill-down: bars = report volume,
 * line = SIF-potential density per 100. Pure SVG, no chart library. */
type Point = { month: string; total: number; sif: number; density: number };

export default function MonthlyTrend({ data }: { data: Point[] }) {
  const W = 640;
  const H = 180;
  const PAD = { l: 8, r: 8, t: 10, b: 22 };
  if (!data.length) {
    return <p className="mt-3 text-sm text-[var(--faint)]">No dated reports for this site.</p>;
  }
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const bw = (W - PAD.l - PAD.r) / data.length;
  const lineY = (d: Point) =>
    PAD.t + (1 - Math.min(d.density, 60) / 60) * (H - PAD.t - PAD.b);
  const barH = (d: Point) => (d.total / maxTotal) * (H - PAD.t - PAD.b) * 0.8;

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${(PAD.l + bw * (i + 0.5)).toFixed(1)},${lineY(d).toFixed(1)}`)
    .join(" ");
  const every = data.length > 12 ? 3 : data.length > 6 ? 2 : 1;

  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full min-w-[480px]" role="img" aria-label="Monthly report volume and SIF density">
        {[0, 15, 30, 45, 60].map((g) => {
          const y = PAD.t + (1 - g / 60) * (H - PAD.t - PAD.b);
          return (
            <g key={g}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={W - PAD.r} y={y - 3} textAnchor="end" fontSize="8" fill="var(--faint)">
                {g}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => (
          <rect
            key={d.month}
            x={PAD.l + bw * i + bw * 0.22}
            y={H - PAD.b - barH(d)}
            width={bw * 0.56}
            height={Math.max(barH(d), 1)}
            rx="1"
            fill="var(--ink-800)"
            stroke="var(--line-strong)"
            strokeWidth="0.5"
          >
            <title>{`${d.month}: ${d.total} reports, ${d.sif} SIF-potential`}</title>
          </rect>
        ))}
        <path d={path} fill="none" stroke="var(--tier-psif)" strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={d.month} cx={PAD.l + bw * (i + 0.5)} cy={lineY(d)} r="2.5" fill="var(--tier-psif)">
            <title>{`${d.month}: ${d.density.toFixed(1)} per 100`}</title>
          </circle>
        ))}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text
              key={d.month}
              x={PAD.l + bw * (i + 0.5)}
              y={H - 8}
              textAnchor="middle"
              fontSize="8"
              fill="var(--faint)"
            >
              {d.month.slice(2)}
            </text>
          ) : null
        )}
      </svg>
      <p className="mt-1 text-[10px] text-[var(--faint)]">
        bars = monthly report volume · line = SIF-potential per 100 (axis 0–60)
      </p>
    </div>
  );
}
