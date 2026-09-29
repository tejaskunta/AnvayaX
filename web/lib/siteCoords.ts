/* Real lat/lng for the monitored sites, so the demo's India widget plots
 * them in the right region (Upper Assam + Guwahati belt). Unknown sites get
 * a deterministic jitter near the cluster centre — same name, same dot. */

const SITE_COORDS: Record<string, { lat: number; lng: number }> = {
  Digboi: { lat: 27.4415, lng: 95.5845 },
  Moran: { lat: 27.5305, lng: 95.0786 },
  Naharkatiya: { lat: 27.4667, lng: 95.4119 },
  Duliajan: { lat: 27.4833, lng: 95.3556 },
  "Jorhat Bypass Road": { lat: 27.5651, lng: 94.2169 },
  "Lumding Terminal": { lat: 27.5533, lng: 93.0703 },
  "Guwahati Depot": { lat: 26.1441, lng: 91.7362 },
  Rangia: { lat: 26.4419, lng: 91.1703 },
};

const FALLBACK = { lat: 27.2, lng: 94.1 };

export function siteCoords(name: string): { lat: number; lng: number } {
  const known = SITE_COORDS[name];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return {
    lat: FALLBACK.lat + (((h % 7) - 3) * 0.11),
    lng: FALLBACK.lng + ((((h >> 3) % 9) - 4) * 0.13),
  };
}
