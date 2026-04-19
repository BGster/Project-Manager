/**
 * runtime/db.ts
 * Garbage collection, retrieval, and init functions for RemX v0.3.0.
 *
 * Ported from db.py (Python) GC functions + init/retrieve.
 * Uses the memories/chunks table schema from Python db.py (not crud.ts).
 */

import { join } from "path";
import Database from "better-sqlite3";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GcCollectResult {
  expiredMemories: Record<string, unknown>[];
  deprecatedMemories: Record<string, unknown>[];
  totalChunks: number;
}

export interface GcSoftDeleteResult {
  expiredMemories: number;
  chunks: number;
}

export interface GcPurgeResult {
  memories: number;
  chunks: number;
}

export interface RetrieveRow extends Record<string, unknown> {
  id: string;
  category: string;
  priority?: string;
  type: string;
  status?: string;
  file_path?: string;
  front_matter?: string;
  deprecated: number;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  content?: string;
  chunk_id?: string;
  chunk_index?: number;
}

export interface RetrieveFilter {
  category?: string | string[];
  priority?: string | string[];
  status?: string | string[];
  type?: string | string[];
  file_path?: string;
  deprecated?: number;
  expires_at?: string | null | Record<string, string>;
  id?: string;
  [key: string]: unknown;
}

// ─── Schema (Python db.py schema) ────────────────────────────────────────────

const MEMORIES_COL_DEFS = `
id TEXT PRIMARY KEY,
category TEXT NOT NULL,
priority TEXT DEFAULT 'P2',
type TEXT NOT NULL,
status TEXT DEFAULT 'active',
file_path TEXT,
front_matter TEXT,
chunk_count INTEGER DEFAULT 0,
deprecated INTEGER DEFAULT 0,
expires_at TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
`.trim();

const CHUNKS_COL_DEFS = `
id TEXT PRIMARY KEY,
parent_id TEXT NOT NULL,
chunk_id TEXT NOT NULL,
chunk_index INTEGER NOT NULL,
content TEXT NOT NULL,
content_hash TEXT,
content_tokens INTEGER,
embedding BLOB,
deprecated INTEGER DEFAULT 0,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
FOREIGN KEY (parent_id) REFERENCES memories(id) ON DELETE CASCADE
`.trim();

// ─── DB Path ─────────────────────────────────────────────────────────────────

const DEFAULT_DB = join(process.env.HOME ?? ".", ".openclaw", "memory", "main.sqlite");

export function getDb(dbPath?: string): Database.Database {
  const d = new Database(dbPath ?? DEFAULT_DB);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  return d;
}

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Initialize database with memories/chunks/memories_vec tables.
 * Call with dimensions from meta.yaml (default 1024).
 */
export function initDb(dbPath: string, dimensions = 1024, reset = false): void {
  const d = getDb(dbPath);
  try {
    if (reset) {
      d.exec(`
        DROP TABLE IF EXISTS memories_vec;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS memories;
      `);
    }

    d.exec(`CREATE TABLE IF NOT EXISTS memories (${MEMORIES_COL_DEFS})`);
    d.exec(`CREATE TABLE IF NOT EXISTS chunks (${CHUNKS_COL_DEFS})`);
    d.exec(
      `CREATE TABLE IF NOT EXISTS memories_vec (chunk_id TEXT PRIMARY KEY, embedding TEXT NOT NULL)`
    );

    // Indexes
    d.exec(`CREATE INDEX IF NOT EXISTS idx_memories_category     ON memories(category)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_memories_status       ON memories(status)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_memories_expires_at   ON memories(expires_at)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_memories_deprecated   ON memories(deprecated)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_memories_file_path    ON memories(file_path)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_parent          ON chunks(parent_id)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_deprecated      ON chunks(deprecated)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_content_hash    ON chunks(content_hash)`);
  } finally {
    d.close();
  }
}

// ─── Vector Upsert ───────────────────────────────────────────────────────────────

/**
 * Upsert a chunk embedding into memories_vec (TEXT column, JSON-serialized array).
 */
export function upsertVector(dbPath: string, chunkId: string, embedding: number[]): void {
  const d = getDb(dbPath);
  try {
    d.prepare(
      `INSERT OR REPLACE INTO memories_vec (chunk_id, embedding) VALUES (?, ?)`
    ).run(chunkId, JSON.stringify(embedding));
  } finally {
    d.close();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function nowIso(): string {
  return new Date().toISOString();
}

export function expiresAtTtl(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
}

export function expiresAtStale(days: number, updatedAt?: string): string {
  const ref = updatedAt ? new Date(updatedAt) : new Date();
  return new Date(ref.getTime() + days * 86400 * 1000).toISOString();
}

// ─── GC: Collect ──────────────────────────────────────────────────────────────

/**
 * Query deprecated/expired records for GC report.
 */
export function gcCollect(
  dbPath: string,
  scopePath?: string
): GcCollectResult {
  const d = getDb(dbPath);
  try {
    const now = nowIso();

    // Expired memories
    let expiredSql = `SELECT * FROM memories WHERE expires_at IS NOT NULL AND expires_at < ? AND deprecated = 0`;
    const expiredParams: unknown[] = [now];

    if (scopePath) {
      expiredSql += ` AND file_path LIKE ?`;
      expiredParams.push(`${scopePath}%`);
    }

    const expiredRows = d.prepare(expiredSql).all(...expiredParams) as Record<string, unknown>[];

    // Deprecated memories
    let deprecatedSql = `SELECT * FROM memories WHERE deprecated = 1`;
    const deprecatedParams: unknown[] = [];

    if (scopePath) {
      deprecatedSql += ` AND file_path LIKE ?`;
      deprecatedParams.push(`${scopePath}%`);
    }

    const deprecatedRows = d
      .prepare(deprecatedSql)
      .all(...deprecatedParams) as Record<string, unknown>[];

    // Chunk count for deprecated
    const chunkCountRow = d
      .prepare(
        `SELECT COUNT(*) as cnt FROM chunks WHERE parent_id IN (SELECT id FROM memories WHERE deprecated = 1)`
      )
      .get() as { cnt: number };

    return {
      expiredMemories: expiredRows,
      deprecatedMemories: deprecatedRows,
      totalChunks: chunkCountRow.cnt,
    };
  } finally {
    d.close();
  }
}

// ─── GC: Soft-Delete ─────────────────────────────────────────────────────────

/**
 * Soft-delete expired/deprecated memories and their chunks.
 */
export function gcSoftDelete(
  dbPath: string,
  scopePath?: string
): GcSoftDeleteResult {
  const d = getDb(dbPath);
  try {
    const now = nowIso();

    // Soft-delete expired memories
    const conditions = [`expires_at IS NOT NULL`, `expires_at < ?`, `deprecated = 0`];
    const params: unknown[] = [now];

    if (scopePath) {
      conditions.push(`file_path LIKE ?`);
      params.push(`${scopePath}%`);
    }

    const where = conditions.join(` AND `);

    const updateMem = d.prepare(
      `UPDATE memories SET deprecated = 1, updated_at = ? WHERE ${where}`
    );
    const memResult = updateMem.run(now, ...params);
    const expiredCount = memResult.changes;

    // Soft-delete chunks of deprecated memories
    const updateChunks = d.prepare(
      `UPDATE chunks SET deprecated = 1, updated_at = ? WHERE parent_id IN (SELECT id FROM memories WHERE deprecated = 1)`
    );
    const chunkResult = updateChunks.run(now);
    const chunkCount = chunkResult.changes;

    return { expiredMemories: expiredCount, chunks: chunkCount };
  } finally {
    d.close();
  }
}

// ─── GC: Purge ───────────────────────────────────────────────────────────────

/**
 * Physically delete all deprecated records and VACUUM.
 */
export function gcPurge(dbPath: string): GcPurgeResult {
  const d = getDb(dbPath);
  try {
    // Delete chunks
    const chunkResult = d.prepare(`DELETE FROM chunks WHERE deprecated = 1`).run();
    const chunkCount = chunkResult.changes;

    // Delete orphaned vectors (chunks already deleted above via CASCADE would
    // also remove their vectors if FK were set, but since memories_vec is
    // independent we clean it explicitly)
    d.prepare(`DELETE FROM memories_vec WHERE chunk_id NOT IN (SELECT id FROM chunks)`).run();

    // Delete memories
    const memResult = d.prepare(`DELETE FROM memories WHERE deprecated = 1`).run();
    const memoryCount = memResult.changes;

    d.exec(`VACUUM`);

    return { memories: memoryCount, chunks: chunkCount };
  } finally {
    d.close();
  }
}

// ─── Retrieve ────────────────────────────────────────────────────────────────

/**
 * Retrieve memories by filter dict → SQL WHERE translation.
 * Supports: category, priority, status, type, file_path, deprecated,
 * expires_at (<, >, =), id.
 */
export function retrieve(
  dbPath: string,
  filter: RetrieveFilter,
  includeContent = true,
  limit = 50
): RetrieveRow[] {
  const d = getDb(dbPath);
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Handle special expires_at comparisons
    if ("expires_at" in filter) {
      const val = filter["expires_at"];
      delete filter["expires_at"];

      if (val === null) {
        conditions.push(`expires_at IS NULL`);
      } else if (typeof val === "object") {
        for (const [op, v] of Object.entries(val as Record<string, string>)) {
          conditions.push(`expires_at ${op} ?`);
          params.push(v);
        }
      } else {
        conditions.push(`expires_at = ?`);
        params.push(val);
      }
    }

    for (const [key, val] of Object.entries(filter)) {
      if (val === undefined) continue;
      if (val === null) {
        conditions.push(`${key} IS NULL`);
      } else if (Array.isArray(val)) {
        const placeholders = val.map(() => `?`).join(`, `);
        conditions.push(`${key} IN (${placeholders})`);
        params.push(...val);
      } else {
        conditions.push(`${key} = ?`);
        params.push(val);
      }
    }

    const whereClause = conditions.length > 0 ? conditions.join(` AND `) : `1=1`;

    let rows: RetrieveRow[];
    if (includeContent) {
      rows = d
        .prepare(
          `SELECT m.*, c.content, c.chunk_id, c.chunk_index
           FROM memories m
           LEFT JOIN chunks c ON c.parent_id = m.id AND c.deprecated = 0
           WHERE m.deprecated = 0 AND ${whereClause}
           ORDER BY m.updated_at DESC
           LIMIT ?`
        )
        .all(...params, limit) as RetrieveRow[];
    } else {
      rows = d
        .prepare(
          `SELECT * FROM memories WHERE deprecated = 0 AND ${whereClause}
           ORDER BY updated_at DESC LIMIT ?`
        )
        .all(...params, limit) as RetrieveRow[];
    }

    return rows;
  } finally {
    d.close();
  }
}

// ─── L2 / Cosine Similarity ─────────────────────────────────────────────────

/** L2 (Euclidean) distance between two vectors. */
function l2Distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Cosine similarity derived from L2 distance.
 *  similarity = 1 / (1 + distance)
 * This is a monotonically decreasing mapping: distance=0 → similarity=1,
 * distance→∞ → similarity→0.
 */
function cosineFromL2(query: number[], candidate: number[]): number {
  return 1 / (1 + l2Distance(query, candidate));
}

// ─── Semantic Retrieve ──────────────────────────────────────────────────────

/**
 * retrieveSemantic — vector-based semantic retrieval.
 *
 * Pipeline:
 *  1. Load all embeddings from memories_vec (TEXT column → JSON array)
 *  2. Compute cosine similarity between queryEmbedding and each stored vector
 *  3. Join with chunks + memories
 *  4. Apply decay scoring: score = (1-decayWeight)*cosine + decayWeight*decay
 *  5. Deduplicate by memory_id (keep best chunk per memory)
 *  6. Sort by score DESC, return top `limit` results
 *
 * Note: memories_vec stores vectors as TEXT (JSON array string) since Node.js
 * lacks struct.pack. The Python version uses BLOB with struct.pack — this is
 * the equivalent representation for portability.
 */
export async function retrieveSemantic(
  dbPath: string,
  queryEmbedding: number[],
  _meta: unknown,
  filter: RetrieveFilter = {},
  includeContent = true,
  limit = 50,
  decayWeight = 0.3
): Promise<RetrieveRow[]> {
  if (queryEmbedding.length === 0) return [];

  const d = getDb(dbPath);
  try {
    // Step 1: Load all (chunk_id, embedding) pairs from memories_vec
    const vecRows = d
      .prepare("SELECT chunk_id, embedding FROM memories_vec")
      .all() as Array<{ chunk_id: string; embedding: string }>;

    if (vecRows.length === 0) return [];

    // Step 2: Compute similarity scores for each chunk
    const scored: Array<{ chunk_id: string; similarity: number }> = [];
    for (const row of vecRows) {
      let embedding: number[];
      try {
        embedding = JSON.parse(row.embedding) as number[];
      } catch {
        continue; // skip malformed vectors
      }
      if (embedding.length !== queryEmbedding.length) continue;
      const similarity = cosineFromL2(queryEmbedding, embedding);
      scored.push({ chunk_id: row.chunk_id, similarity });
    }

    if (scored.length === 0) return [];

    // Step 3: Build filter conditions for the SQL query
    const conditions: string[] = ["m.deprecated = 0"];
    const params: unknown[] = [];

    if (filter.category) {
      if (Array.isArray(filter.category)) {
        const placeholders = filter.category.map(() => `?`).join(`, `);
        conditions.push(`m.category IN (${placeholders})`);
        params.push(...filter.category);
      } else {
        conditions.push(`m.category = ?`);
        params.push(filter.category);
      }
    }
    if (filter.status) {
      conditions.push(`m.status = ?`);
      params.push(filter.status);
    }
    if (filter.type) {
      conditions.push(`m.type = ?`);
      params.push(filter.type);
    }
    if (filter.deprecated !== undefined) {
      conditions.push(`m.deprecated = ?`);
      params.push(filter.deprecated);
    }

    const filterClause = conditions.length > 0 ? conditions.join(` AND `) : `1=1`;

    // Step 4: Build chunk_id IN (...) list
    const chunkIds = scored.map((s) => s.chunk_id);
    const inClause = chunkIds.map(() => `?`).join(`, `);

    let rows: RetrieveRow[];
    if (includeContent) {
      rows = d
        .prepare(
          `SELECT m.*, c.content, c.chunk_id, c.chunk_index
           FROM memories m
           JOIN chunks c ON c.parent_id = m.id AND c.deprecated = 0
           WHERE c.chunk_id IN (${inClause}) AND ${filterClause}
           ORDER BY m.updated_at DESC`
        )
        .all(...chunkIds, ...params) as RetrieveRow[];
    } else {
      rows = d
        .prepare(
          `SELECT m.*, c.chunk_id, c.chunk_index
           FROM memories m
           JOIN chunks c ON c.parent_id = m.id AND c.deprecated = 0
           WHERE c.chunk_id IN (${inClause}) AND ${filterClause}
           ORDER BY m.updated_at DESC`
        )
        .all(...chunkIds, ...params) as RetrieveRow[];
    }

    // Step 5: Score with hybrid (cosine + decay) and deduplicate by memory_id
    const now = Date.now();

    // cosine map: chunk_id → similarity
    const cosineMap = new Map(scored.map((s) => [s.chunk_id, s.similarity]));

    // Decay function (mirrors recall.ts computeDecayFactor but inline for perf)
    function decayFactor(updatedAt: string, expiresAt: string | undefined, category: string): number {
      if (category === "tmp") {
        if (!expiresAt) return 1.0;
        const remaining = new Date(expiresAt).getTime() - now;
        const ttlMs = 24 * 3600 * 1000;
        return Math.max(0.0, Math.min(1.0, remaining / ttlMs));
      }
      if (category === "demand" || category === "issue") {
        const updatedMs = new Date(updatedAt).getTime();
        const daysSince = (now - updatedMs) / (86400 * 1000);
        const staleDays = 7;
        const rate = 0.1;
        if (daysSince <= staleDays) return 1.0;
        return Math.max(0.0, Math.exp(-rate * (daysSince - staleDays)));
      }
      return 1.0; // knowledge, principle, etc.
    }

    // Best chunk per memory_id
    const bestPerMemory = new Map<string, RetrieveRow>();
    for (const row of rows) {
      const cid = row.chunk_id!;
      const sid = row.id;
      const sim = cosineMap.get(cid) ?? 0;
      const dec = decayFactor(row.updated_at, row.expires_at as string | undefined, row.category);
      const score = (1 - decayWeight) * sim + decayWeight * dec;

      const existing = bestPerMemory.get(sid);
      if (!existing || score > ((existing as unknown as { _score?: number })._score ?? -1)) {
        (row as unknown as { _score?: number })._score = score;
        bestPerMemory.set(sid, row);
      }
    }

    // Step 6: Sort by score DESC, apply limit
    const results = Array.from(bestPerMemory.values());
    results.sort((a, b) => {
      const sa = (a as unknown as { _score?: number })._score ?? 0;
      const sb = (b as unknown as { _score?: number })._score ?? 0;
      return sb - sa;
    });

    // Remove internal _score field before returning
    for (const row of results) {
      delete (row as unknown as { _score?: number })._score;
    }

    return results.slice(0, limit);
  } finally {
    d.close();
  }
}
