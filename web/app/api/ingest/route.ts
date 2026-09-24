/* POST /api/ingest — bulk upload of incident reports.
 * Accepts multipart/form-data with a .csv/.xlsx file, or JSON:
 *   { rows: [{text, id?, site?, activity?, occurred_at?}], filename? }
 * Every row is classified by the ML service; results + embeddings persisted. */
import { NextRequest, NextResponse } from "next/server";

import * as XLSX from "xlsx";

import { getDb } from "@/db/client";
import { ingestRows, type IngestRowInput } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 600; // 750-row CPU batch

type RawRow = Record<string, string | number | undefined>;

function toRows(raw: RawRow[]): IngestRowInput[] {
  return raw
    .map((r) => {
      const g = (k: string) => String(r[k] ?? "").trim();
      return {
        id: g("id") || undefined,
        text: g("text") || g("description") || g("report") || "",
        site: g("site") || undefined,
        activity: g("activity") || undefined,
        occurredAt: g("occurred_at") || g("date") || undefined,
        sourceLayer: "upload",
        isSynthetic: false,
      };
    })
    .filter((r) => r.text.length > 0);
}

function parseTable(buf: Buffer, filename: string): RawRow[] {
  const wb =
    filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls")
      ? XLSX.read(buf, { type: "buffer" })
      : XLSX.read(buf.toString("utf8"), { type: "string" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" });
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let rows: IngestRowInput[] = [];
    let filename: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "expected a 'file' field" }, { status: 400 });
      }
      filename = file.name;
      const buf = Buffer.from(await file.arrayBuffer());
      if (/\.(csv|xlsx?|json)$/i.test(file.name) === false && !buf.length) {
        return NextResponse.json({ error: "empty file" }, { status: 400 });
      }
      if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(buf.toString("utf8"));
        rows = toRows(Array.isArray(data) ? data : data.rows ?? []);
      } else {
        rows = toRows(parseTable(buf, file.name));
      }
    } else {
      const body = await req.json().catch(() => null);
      if (!body || !Array.isArray(body.rows)) {
        return NextResponse.json(
          { error: "expected { rows: [...] } JSON or multipart file upload" },
          { status: 400 }
        );
      }
      rows = toRows(body.rows);
      filename = body.filename;
    }

    if (!rows.length) {
      return NextResponse.json({ error: "no usable rows (need a 'text' column)" }, { status: 400 });
    }
    if (rows.length > 5000) {
      return NextResponse.json({ error: "max 5000 rows per upload" }, { status: 413 });
    }

    const db = getDb();
    const summary = await ingestRows(db, rows, { filename, source: "upload" });
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
