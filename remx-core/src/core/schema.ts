/**
 * schema.ts
 * Meta.yaml schema models for RemX v0.3.0.
 *
 * Ported from schema.py (Python) → TypeScript.
 * Plain TS classes + YAML parsing (no pydantic).
 */

import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";

// ─── Embedder Config ──────────────────────────────────────────────────────────

export interface EmbedderConfig {
  provider: string;
  model: string;
  base_url: string;
  timeout: number;
  api_key: string | null;
}

export const DEFAULT_EMBEDDER_CONFIG: EmbedderConfig = {
  provider: "ollama",
  model: "bge-m3",
  base_url: "http://localhost:11434",
  timeout: 60,
  api_key: null,
};

// ─── Normal Dimensions ────────────────────────────────────────────────────────

export interface NormalDimension {
  name: string;
  values: string[];
}

export interface DecayDimension {
  name: string;
  values: string[];
}

export interface NormalDimensions {
  normal: NormalDimension[];
  decay: DecayDimension[];
}

export const DEFAULT_NORMAL_DIMENSIONS: NormalDimensions = {
  normal: [],
  decay: [],
};

// ─── Decay Groups ─────────────────────────────────────────────────────────────

export interface DecayGroup {
  name: string;
  trigger: Record<string, string>;  // e.g. {"category": "tmp"}
  function: string;                  // "ttl" or "stale_after"
  params: Record<string, unknown>;   // e.g. {"ttl_hours": 24}
  apply_fields: string[];            // e.g. ["created_at", "expires_at"]
}

export const DEFAULT_DECAY_GROUPS: DecayGroup[] = [
  {
    name: "tmp_default",
    trigger: { category: "tmp" },
    function: "ttl",
    params: { ttl_hours: 24 },
    apply_fields: ["created_at", "expires_at"],
  },
  {
    name: "demand_default",
    trigger: { category: "demand" },
    function: "stale_after",
    params: { days: 90 },
    apply_fields: ["created_at", "expires_at"],
  },
  {
    name: "issue_default",
    trigger: { category: "issue" },
    function: "stale_after",
    params: { days: 60 },
    apply_fields: ["created_at", "expires_at"],
  },
  // knowledge and principle default to never (no decay)
];

// ─── Index Scope ──────────────────────────────────────────────────────────────

export interface IndexScope {
  path: string;
  pattern: string;
}

export const DEFAULT_INDEX_SCOPE: IndexScope = {
  path: "",
  pattern: "*.md",
};

// ─── Vector Config ────────────────────────────────────────────────────────────

export interface VectorConfig {
  dimensions: number;
  table: string;
  key_column: string;
  embedding_column: string;
}

export const DEFAULT_VECTOR_CONFIG: VectorConfig = {
  dimensions: 1024,
  table: "memories_vec",
  key_column: "chunk_id",
  embedding_column: "embedding",
};

// ─── Chunk Config ─────────────────────────────────────────────────────────────

export interface ChunkConfig {
  max_tokens: number;
  overlap: number;
  strategy: string;
  heading_levels: number[];
  preserve: string[];
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  max_tokens: 512,
  overlap: 0,
  strategy: "heading",
  heading_levels: [1, 2, 3],
  preserve: ["code_blocks", "tables"],
};

// ─── Root meta.yaml Model ────────────────────────────────────────────────────

export interface MetaYaml {
  name: string;
  version: string;
  index_scope: IndexScope[];
  dimensions: NormalDimensions;
  decay_groups: DecayGroup[];
  vector: VectorConfig;
  chunk: ChunkConfig;
  embedder: EmbedderConfig | null;
}

export const DEFAULT_META_YAML: MetaYaml = {
  name: "project",
  version: "1",
  index_scope: [],
  dimensions: DEFAULT_NORMAL_DIMENSIONS,
  decay_groups: [],
  vector: DEFAULT_VECTOR_CONFIG,
  chunk: DEFAULT_CHUNK_CONFIG,
  embedder: DEFAULT_EMBEDDER_CONFIG,
};

// ─── MetaYaml Class ──────────────────────────────────────────────────────────

export class MetaYamlModel {
  name: string = "project";
  version: string = "1";
  index_scope: IndexScope[] = [];
  dimensions: NormalDimensions = DEFAULT_NORMAL_DIMENSIONS;
  decay_groups: DecayGroup[] = [];
  vector: VectorConfig = DEFAULT_VECTOR_CONFIG;
  chunk: ChunkConfig = DEFAULT_CHUNK_CONFIG;
  embedder: EmbedderConfig | null = DEFAULT_EMBEDDER_CONFIG;

  constructor(data: Partial<MetaYaml> = {}) {
    this.name = data.name ?? "project";
    this.version = data.version ?? "1";
    this.index_scope = data.index_scope ?? [];
    this.dimensions = data.dimensions ?? DEFAULT_NORMAL_DIMENSIONS;
    this.decay_groups = data.decay_groups ?? [];
    this.vector = data.vector ?? DEFAULT_VECTOR_CONFIG;
    this.chunk = data.chunk ?? DEFAULT_CHUNK_CONFIG;
    this.embedder = data.embedder ?? DEFAULT_EMBEDDER_CONFIG;
  }

  /**
   * Load and validate a meta.yaml file.
   */
  static load(p: string): MetaYamlModel {
    const text = fs.readFileSync(p, "utf-8");
    const raw = YAML.parse(text) ?? {};
    return new MetaYamlModel(raw as Partial<MetaYaml>);
  }

  /**
   * Serialize to formatted JSON string.
   */
  toJson(): string {
    return JSON.stringify(this.toRaw(), null, 2);
  }

  /**
   * Convert to plain object (for serialization).
   */
  toRaw(): MetaYaml {
    return {
      name: this.name,
      version: this.version,
      index_scope: this.index_scope,
      dimensions: this.dimensions,
      decay_groups: this.decay_groups,
      vector: this.vector,
      chunk: this.chunk,
      embedder: this.embedder,
    };
  }

  /**
   * Find the first matching index_scope for a file path.
   */
  findScope(filePath: string, metaYamlDir?: string): IndexScope | null {
    const base = metaYamlDir ? path.resolve(metaYamlDir) : path.dirname(filePath);
    for (const scope of this.index_scope) {
      let scopePath: string;
      if (path.isAbsolute(scope.path)) {
        scopePath = scope.path;
      } else {
        scopePath = path.resolve(base, scope.path);
      }
      try {
        const fileResolved = path.resolve(filePath);
        const rel = path.relative(scopePath, fileResolved);
        // Match pattern loosely (glob-style)
        const pattern = scope.pattern;
        const fnmatch = (str: string, pat: string): boolean => {
          // Simple fnmatch: handle *.ext and exact names
          if (pat.startsWith("*")) {
            const ext = pat.slice(1);
            return str.endsWith(ext);
          }
          return str === pat;
        };
        if (fnmatch(path.basename(rel), pattern) || fnmatch(path.basename(rel), "*" + pattern.replace("*.", ""))) {
          return scope;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Inferred category from index_scope path (convention: last path component).
   */
  extractCategoryFromScope(scope: IndexScope): string | null {
    const name = path.basename(scope.path).replace(/\/$/, "");
    return name || null;
  }

  /**
   * Find the first decay_group whose trigger matches category (+ optional status).
   * Falls back to DEFAULT_DECAY_GROUPS if no explicit decay_group matches.
   */
  decayGroupFor(category: string, status?: string | null): DecayGroup | null {
    // First: explicit decay_groups in meta.yaml
    for (const dg of this.decay_groups) {
      const trigger = dg.trigger;
      const catMatch = trigger["category"] === category;
      if (!catMatch) continue;
      if ("status" in trigger) {
        if (status === undefined || trigger["status"] !== status) continue;
      }
      return dg;
    }
    // Fall back: built-in defaults
    for (const dg of DEFAULT_DECAY_GROUPS) {
      if (dg.trigger["category"] === category) return dg;
    }
    return null;
  }

  /**
   * Check if a dimension value is allowed by meta.yaml config.
   */
  validateValue(dimName: string, value: string, isDecay = false): boolean {
    const dims = isDecay ? this.dimensions.decay : this.dimensions.normal;
    for (const dim of dims) {
      if (dim.name === dimName) {
        return dim.values.includes(value);
      }
    }
    // If dimension not defined, allow any value (open world)
    return true;
  }
}
