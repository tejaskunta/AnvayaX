/* Date-cell normalization for spreadsheet parsing.
 * SheetJS auto-coerces ISO date strings to Excel serial numbers (e.g.
 * "2026-07-03" -> 46206.229…) when the parser detects date types. Anything
 * that survives as a bare number is converted back to an ISO date string so
 * the rest of the pipeline only ever sees parseable dates. */

const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;
const SERIAL_RE = /^\d{4,6}(\.\d+)?$/;

/** Excel 1900 date system epoch: 1899-12-30 UTC. */
const EPOCH = Date.UTC(1899, 11, 30);

export function normalizeDateCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (ISO_RE.test(s)) return s.slice(0, 10);
  if (SERIAL_RE.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 0 && serial < 100000) {
      return new Date(EPOCH + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
    }
  }
  // Last resort: let Date parse it (e.g. "03/07/2026" is ambiguous — reject it).
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
