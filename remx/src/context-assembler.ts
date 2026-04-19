/**
 * ContextAssembler — assembles retrieval results into LLM-ready context
 *
 * Responsibilities:
 * - Call remx retrieve (via subprocess)
 * - Format results as readable context text
 * - Handle truncation and deduplication
 */
import { execSync } from "child_process";
import { existsSync } from "fs";

export interface AssembleOptions {
  dbPath: string;
  metaPath?: string;
  category?: string;
  filter?: Record<string, any>;
  query?: string;
  limit?: number;
  decayWeight?: number;
  requireContent?: boolean;
}

interface MemoryRecord {
  id: string;
  category: string;
  priority?: string;
  status?: string;
  file_path?: string;
  chunk_count?: number;
  updated_at?: string;
  expires_at?: string;
  content?: string;
  chunk_id?: string;
  chunk_index?: number;
  score?: number;
}

interface RetrieveResult {
  id: string;
  category: string;
  priority?: string;
  status?: string;
  file_path?: string;
  updated_at?: string;
  expires_at?: string;
  content?: string;
  chunk_id?: string;
  chunk_index?: number;
  score?: number;
}

/**
 * Assemble context from natural language query
 */
export function assemble(query: string, options: AssembleOptions): string {
  if (!existsSync(options.dbPath)) {
    return "RemX 未初始化，请先运行 `remx init`";
  }

  try {
    const records = retrieve(options);
    if (records.length === 0) {
      return "没有找到匹配的记录。";
    }
    return formatResults(records);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      return "RemX 未初始化，请先运行 `remx init`";
    }
    return `检索失败: ${err.message}`;
  }
}

/**
 * Retrieve memories by filter
 */
export function byFilter(filter: Record<string, any>, options: Omit<AssembleOptions, "filter" | "query">): string {
  return assemble("", { ...options, filter });
}

/**
 * Retrieve by category
 */
export function byCategory(category: string, options: Omit<AssembleOptions, "category" | "query">): string {
  return assemble("", { ...options, category });
}

/**
 * Call remx retrieve and parse results
 */
function retrieve(options: AssembleOptions): RetrieveResult[] {
  const args: string[] = ["retrieve", "--db", options.dbPath];

  if (options.metaPath) {
    args.push("--meta", options.metaPath);
  }

  if (options.query) {
    args.push("--query", options.query);
    if (options.decayWeight !== undefined) {
      args.push("--decay-weight", String(options.decayWeight));
    }
  }

  if (options.filter) {
    args.push("--filter", JSON.stringify(options.filter));
  }

  if (options.limit) {
    args.push("--limit", String(options.limit));
  } else {
    args.push("--limit", "10");
  }

  // Note: --no-embed skips embedding generation for pure filter queries
  const cmd = `npx remx ${args.join(" ")}`;

  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Fallback: try direct import if npx fails
    try {
      const { execSync: ex } = require("child_process");
      const output = ex(`node -e "const { retrieve } = require('/home/claw/RemX/remx-core/dist/runtime/db.js'); console.log(JSON.stringify(retrieve('${options.dbPath}', ${JSON.stringify(options.filter || {})}, true, ${options.limit || 10})))"`, { encoding: "utf-8" });
      return JSON.parse(output);
    } catch {
      return [];
    }
  }
}

/**
 * Format a single memory record
 */
export function formatSingle(record: MemoryRecord): string {
  const lines: string[] = [];
  lines.push(`## ${record.id || "Unknown"}`);
  if (record.category) lines.push(`**Category:** ${record.category}`);
  if (record.priority) lines.push(`**Priority:** ${record.priority}`);
  if (record.status) lines.push(`**Status:** ${record.status}`);
  if (record.updated_at) lines.push(`**Updated:** ${record.updated_at}`);
  if (record.expires_at) lines.push(`**Expires:** ${record.expires_at}`);
  lines.push("");
  lines.push("---");
  if (record.content) {
    lines.push(record.content);
  }
  return lines.join("\n");
}

/**
 * Format retrieval results into readable context
 */
function formatResults(records: RetrieveResult[]): string {
  const parts: string[] = [];
  parts.push(`## 记忆上下文（${records.length} 条）`);
  parts.push("");

  // Group by memory id
  const byMemory = new Map<string, RetrieveResult[]>();
  for (const r of records) {
    const key = r.id;
    if (!byMemory.has(key)) byMemory.set(key, []);
    byMemory.get(key)!.push(r);
  }

  let count = 0;
  for (const [memoryId, recs] of byMemory) {
    count++;
    // Sort chunks by chunk_index
    recs.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));

    parts.push(`### [${count}] ${memoryId}`);
    if (recs[0].category) parts.push(`**Category:** ${recs[0].category}`);
    if (recs[0].status) parts.push(`**Status:** ${recs[0].status}`);
    if (recs[0].score) parts.push(`**Relevance:** ${(recs[0].score * 100).toFixed(1)}%`);
    parts.push("");
    parts.push("---");

    for (const rec of recs) {
      if (rec.content) {
        parts.push(rec.content);
        parts.push("");
        parts.push("---");
      }
    }
    parts.push("");
  }

  return parts.join("\n");
}
