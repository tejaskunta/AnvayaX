/* Typed client for the stateless FastAPI ML microservice.
 * The web app never implements ML logic — every tier/tag/embedding comes from here.
 * Mirrors ml-service/model/schema.py — change one, change the other. */

export type RuleTag = {
  rule: string;
  matched_phrases: string[];
  confidence: number;
};

export type Precursors = {
  activities: string[];
  locations: string[];
  barrier_failures: string[];
  energy_sources: string[];
};

export type ClassifyResult = {
  tiers: Record<string, number>; // {near_miss, recordable, psif, asif}
  tier: string; // argmax
  severity_index: number; // 25..100
  confidence: number;
  needs_review: boolean;
  rule_tags: RuleTag[];
  precursors: Precursors;
  embedding: number[] | null; // 384-dim float
  model_version: string;
  acquisition_score: number | null; // 0..1 active-learning priority
  mode: "transformer" | "rules_only";
};

export type RegistryRow = {
  version: string;
  registered_at: string;
  gate_result: string;
  champion_before: string | null;
  sif_recall: number | null;
  metrics: Record<string, unknown> | null;
  trained_on_rows: number | null;
  note: string | null;
};

export type ModelInfo = {
  active_version: string;
  mode: "transformer" | "rules_only";
  base_model: string;
  embedding_model: string;
  embedding_dim: number;
  tiers: string[];
  severity_weights: Record<string, number>;
  review_threshold: number;
  rule_threshold: number;
  refresh_interval_days: number;
  gate_recall_tolerance_pp: number;
  champion_metrics: Record<string, unknown> | null;
  registry: RegistryRow[];
};

export type GateReport = {
  promoted: boolean;
  challenger_version: string;
  champion_version: string | null;
  sif_recall_challenger: number;
  sif_recall_champion: number | null;
  delta_pp: number | null;
  reason: string;
};

export type TrainResponse = {
  gate: GateReport;
  challenger_metrics: Record<string, unknown>;
  promoted: boolean;
};

const BASE = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";

/* Node's undici applies its own ~300s headersTimeout regardless of AbortSignal;
 * long /train and /classify-batch calls died with UND_ERR_HEADERS_TIMEOUT.
 * Raise the socket-level timeouts to match our longest call (1h). */
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({ headersTimeout: 3_700_000, bodyTimeout: 3_700_000, keepAliveTimeout: 60_000 })
);

async function post<T>(path: string, body: unknown, timeoutMs = 60000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ML service ${path} -> ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string, timeoutMs = 10000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ML service ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const mlApi = {
  health: () =>
    get<{ status: string; mode: string; active_version: string; time: number }>("/health"),
  classify: (text: string) => post<ClassifyResult>("/classify", { text }),
  classifyBatch: (texts: string[]) =>
    post<{ results: ClassifyResult[] }>("/classify-batch", { texts }, 600000),
  modelInfo: () => get<ModelInfo>("/model-info"),
  train: (rows: { text: string; tier: string; weight?: number }[], note?: string) =>
    post<TrainResponse>("/train", { rows, note }, 3600000), // LoRA refresh: minutes
};
