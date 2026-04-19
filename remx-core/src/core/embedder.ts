/**
 * embedder.ts
 * Embedding provider abstraction for RemX v0.3.0.
 *
 * Ported from embedding.py (Python) → TypeScript.
 * Supports Ollama and OpenAI providers.
 *
 * Note: uses native Node.js fetch (available in Node 18+).
 * httpx is installed as a dependency but not used (Node fetch is cleaner
 * for this use case). Kept in package.json in case we need HTTP2/pooling later.
 */

import type { EmbedderConfig } from "./schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Embedder {
  /** Embed a list of texts into vectors. */
  embed(texts: string[]): Promise<number[][]>;
}

// ─── Ollama Embedder ─────────────────────────────────────────────────────────

export interface OllamaEmbedderConfig {
  baseUrl?: string;
  model?: string;
  timeout?: number;
}

export class OllamaEmbedder implements Embedder {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(cfg: OllamaEmbedderConfig = {}) {
    this.baseUrl = cfg.baseUrl ?? "http://localhost:11434";
    this.model = cfg.model ?? "bge-m3";
    this.timeout = cfg.timeout ?? 60;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Serial per-text embedding (current).
    // TODO(batch): Use Ollama batch /api/embeddings endpoint with multiple prompts
    //              when the server supports it for better throughput.
    const results: number[][] = [];
    for (const text of texts) {
      const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(this.timeout * 1000),
      });
      if (!resp.ok) {
        throw new Error(`Ollama embed failed: ${resp.status} ${resp.statusText}`);
      }
      const data = (await resp.json()) as { embedding: number[] };
      results.push(data.embedding);
    }
    return results;
  }
}

// ─── OpenAI Embedder ─────────────────────────────────────────────────────────

export interface OpenAIEmbedderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

export class OpenAIEmbedder implements Embedder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly dimensions: number;

  constructor(cfg: OpenAIEmbedderConfig) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model ?? "text-embedding-3-small";
    this.baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
    this.dimensions = cfg.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI embed failed: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    // Response data may not be in input order — sort by index
    const sorted = [...data.data].sort((a, b) => {
      const ai = texts.indexOf(a as unknown as string);
      const bi = texts.indexOf(b as unknown as string);
      return ai - bi;
    });
    return sorted.map((item) => item.embedding);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface CreateEmbedderOptions {
  provider?: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  apiKey?: string;
  dimensions?: number;
}

/**
 * Create an embedder from explicit options (bypassing meta.yaml).
 */
export function createEmbedder(opts: CreateEmbedderOptions = {}): Embedder | null {
  const provider = opts.provider ?? "ollama";
  if (provider === "ollama") {
    return new OllamaEmbedder({
      baseUrl: opts.baseUrl,
      model: opts.model ?? "bge-m3",
      timeout: opts.timeout ?? 60,
    });
  }
  if (provider === "openai") {
    if (!opts.apiKey) return null;
    return new OpenAIEmbedder({
      apiKey: opts.apiKey,
      model: opts.model ?? "text-embedding-3-small",
      baseUrl: opts.baseUrl,
      dimensions: opts.dimensions,
    });
  }
  return null;
}

/**
 * Create an embedder from a meta.yaml EmbedderConfig.
 */
export function createEmbedderFromConfig(cfg: EmbedderConfig | null): Embedder | null {
  if (!cfg) return null;
  return createEmbedder({
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.base_url,
    timeout: cfg.timeout,
    apiKey: cfg.api_key ?? undefined,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * getEmbedding — get a single embedding, returning null on failure.
 */
export async function getEmbedding(
  embedder: Embedder | null,
  text: string
): Promise<number[] | null> {
  if (!embedder) return null;
  try {
    const results = await embedder.embed([text]);
    return results[0] ?? null;
  } catch {
    // Silently return null — caller handles missing embedding gracefully
    return null;
  }
}
