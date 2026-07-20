import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateOpenAiCostUsd, type UsageTotals } from "./usage.js";

/**
 * Community model pricing from https://models.dev (167+ providers).
 *
 * Loaded once per server session: fresh fetch first, last-good disk cache on
 * network failure, and the hardcoded OpenAI table in usage.ts as the final
 * fallback. The disk cache lives under data/ (gitignored).
 */

const MODELS_DEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 10_000;
const DISK_CACHE_PATH = join(process.cwd(), "data", "model-prices-cache.json");

export interface ModelCost {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached-input (read) tokens. */
  cacheRead: number;
  /** USD per 1M cache-creation (write) tokens. */
  cacheWrite: number;
}

/** Subset of the models.dev api.json shape this module reads. */
export interface ModelsDevDataset {
  [providerId: string]: {
    models?: {
      [modelId: string]: {
        cost?: {
          input?: number;
          output?: number;
          cache_read?: number;
          cache_write?: number;
        };
      };
    };
  };
}

let sessionDataset: ModelsDevDataset | null | undefined;

async function fetchDataset(): Promise<ModelsDevDataset | null> {
  try {
    const res = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ModelsDevDataset;
    await mkdir(join(process.cwd(), "data"), { recursive: true });
    await writeFile(DISK_CACHE_PATH, JSON.stringify(data), "utf8");
    return data;
  } catch {
    return null;
  }
}

async function readDiskCache(): Promise<ModelsDevDataset | null> {
  try {
    return JSON.parse(await readFile(DISK_CACHE_PATH, "utf8")) as ModelsDevDataset;
  } catch {
    return null;
  }
}

/**
 * Loads the pricing dataset for this session (idempotent). A failed fetch
 * falls back to the last-good disk cache; a failed read is remembered for the
 * session so we never hammer the network or disk mid-run.
 */
export async function ensureModelPrices(): Promise<void> {
  if (sessionDataset !== undefined) return;
  sessionDataset = (await fetchDataset()) ?? (await readDiskCache());
}

/** Host substrings → models.dev provider ids, used to disambiguate model ids. */
const HOST_PROVIDER_HINTS: Array<[string, string]> = [
  ["z.ai", "zai"],
  ["openai.com", "openai"],
  ["openrouter", "openrouter"],
  ["groq", "groq"],
  ["together", "together"],
  ["fireworks", "fireworks"],
  ["deepseek", "deepseek"],
  ["mistral", "mistral"],
  ["x.ai", "xai"],
  ["generativelanguage", "google"],
  ["anthropic", "anthropic"],
  ["cerebras", "cerebras"],
];

function providerHintFromBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  const lower = baseUrl.toLowerCase();
  return HOST_PROVIDER_HINTS.find(([host]) => lower.includes(host))?.[1] ?? null;
}

function costFromEntry(
  entry: { cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number } } | undefined,
): ModelCost | null {
  const cost = entry?.cost;
  if (cost?.input == null || cost.output == null) return null;
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache_read ?? 0,
    cacheWrite: cost.cache_write ?? 0,
  };
}

function findInProvider(data: ModelsDevDataset, providerId: string, model: string): ModelCost | null {
  const models = data[providerId]?.models;
  if (!models) return null;
  const exact = costFromEntry(models[model]);
  if (exact) return exact;
  // Tolerate date/version suffixes on either side (e.g. "gpt-5" vs "gpt-5-20250807").
  const match = Object.keys(models)
    .sort((a, b) => b.length - a.length)
    .find((id) => {
      const lower = id.toLowerCase();
      return model.startsWith(lower) || lower.startsWith(model);
    });
  return match ? costFromEntry(models[match]) : null;
}

/**
 * Finds the price for a model, preferring the provider hinted by the base URL
 * (same model id can exist on several providers at different prices).
 */
export function findModelCost(
  data: ModelsDevDataset,
  model: string,
  baseUrl?: string,
): ModelCost | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;

  const hint = providerHintFromBaseUrl(baseUrl);
  if (hint) {
    const hinted = findInProvider(data, hint, normalized);
    if (hinted) return hinted;
  }
  for (const providerId of Object.keys(data)) {
    if (providerId === hint) continue;
    const found = findInProvider(data, providerId, normalized);
    if (found) return found;
  }
  return null;
}

/**
 * Estimates cost for the custom OpenAI-compatible runtime using the
 * models.dev dataset, falling back to the hardcoded OpenAI table and then 0.
 * Prices are API-equivalent estimates — subscription plans (e.g. z.ai coding)
 * don't bill per token.
 */
export function estimateCustomCostUsd(
  usage: Omit<UsageTotals, "costUsd">,
  baseUrl?: string,
): number {
  const price = sessionDataset ? findModelCost(sessionDataset, usage.model, baseUrl) : null;
  if (!price) return estimateOpenAiCostUsd(usage);

  const cachedInputTokens = Math.max(0, usage.cacheReadTokens);
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - cachedInputTokens + usage.cacheCreationTokens,
  );
  return (
    (uncachedInputTokens * price.input +
      cachedInputTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
