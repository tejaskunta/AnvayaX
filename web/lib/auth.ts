/* Demo auth — cookie-based role switch for the walkthrough. NOT real auth:
 * there are no passwords or sessions; picking a role at /login writes a
 * readable cookie that middleware + the nav rail honour. Swap for Clerk (or
 * Auth.js) by replacing this module's ROLE table + the two /api/auth routes. */

export type Role = "admin" | "supervisor" | "hse";

export const ROLE_COOKIE = "anvaya_role";
export const USER_COOKIE = "anvaya_user";

export type RoleDef = {
  label: string;
  user: string;
  blurb: string;
  /* page prefixes this role may open; "/" is exact-match home */
  pages: string[];
};

export const ROLES: Record<Role, RoleDef> = {
  admin: {
    label: "Admin",
    user: "R. Bordoloi · HSSE Head",
    blurb: "Full access — ingest, review queue, model insight, everything.",
    pages: ["/", "/feed", "/queue", "/sandbox", "/ingest", "/model", "/report", "/site"],
  },
  supervisor: {
    label: "Site supervisor",
    user: "A. Gogoi · Digboi",
    blurb: "Site views, feed, sandbox and the review queue. No ingest, no model tuning.",
    pages: ["/", "/feed", "/queue", "/sandbox", "/report", "/site"],
  },
  hse: {
    label: "HSE team",
    user: "S. Barua · HSSE",
    blurb: "Read-only intelligence — feed, sites, reports and model insight.",
    pages: ["/", "/feed", "/model", "/report", "/site"],
  },
};

export function parseRole(value: string | undefined | null): Role | null {
  return value === "admin" || value === "supervisor" || value === "hse" ? value : null;
}

/* Longest-prefix match: /report/abc is covered by "/report". "/" must match exactly. */
export function canAccess(role: Role | null, path: string): boolean {
  if (!role) return false;
  const allowed = ROLES[role].pages;
  if (path === "/") return allowed.includes("/");
  return allowed.some((p) => p !== "/" && (path === p || path.startsWith(p + "/")));
}

/* API surface maps onto the page it powers, so the same table gates both. */
const API_TO_PAGE: [string, string][] = [
  ["/api/queue", "/queue"],
  ["/api/analyze", "/sandbox"],
  ["/api/ingest", "/ingest"],
  ["/api/batches", "/ingest"],
  ["/api/refresh", "/model"],
  ["/api/model-insight", "/model"],
];

export function apiGate(role: Role | null, path: string): boolean {
  const hit = API_TO_PAGE.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"));
  if (!hit) return true; // status, reports, sites are shared read data
  return canAccess(role, hit[1]);
}
