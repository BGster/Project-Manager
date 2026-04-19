/**
 * skill-integration.ts
 *
 * RemX Skill 与 OpenClaw 的集成脚本。
 * 提供 remx CLI 命令的 TypeScript 包装函数，供 Agent 在决策时调用。
 *
 * 所有操作均通过 remx CLI 发起，不直接访问源码或数据库文件。
 *
 * 使用方式：
 *   import { remxRetrieve, remxIndex, remxGc } from './scripts/skill-integration.ts';
 */

import { execSync, exec } from "child_process";
import { readFileSync } from "fs";
import path from "path";

// ─── 环境配置 ────────────────────────────────────────────────────────────────

const REMX_DB = process.env.REMX_DB ?? "./memory.db";
const REMX_META = process.env.REMX_META ?? "./meta.yaml";

// ─── CLI 辅助函数 ────────────────────────────────────────────────────────────

function remx(args: string[], options?: { input?: string }): string {
  const cmd = ["remx", ...args].join(" ");
  try {
    if (options?.input) {
      return execSync(cmd, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        input: options.input,
      });
    }
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err: any) {
    return err.stdout ?? err.message;
  }
}

// ─── 召回记忆 ────────────────────────────────────────────────────────────────

export interface RetrieveOptions {
  query?: string;
  filter?: Record<string, any>;
  limit?: number;
  decayWeight?: number;
  noEmbed?: boolean;
}

/**
 * remx retrieve — 过滤或语义检索记忆。
 *
 * @param opts.query       自然语言查询（语义模式）
 * @param opts.filter      JSON filter（过滤模式）
 * @param opts.limit       返回条数，默认 50
 * @param opts.decayWeight 衰减权重（0.0~1.0），默认 0.3
 */
export function remxRetrieve(opts: RetrieveOptions): any[] {
  const args = ["retrieve", "--db", REMX_DB];

  if (opts.query) {
    args.push("--query", opts.query, "--meta", REMX_META);
    if (opts.decayWeight !== undefined) {
      args.push("--decay-weight", String(opts.decayWeight));
    }
  } else if (opts.filter) {
    args.push("--filter", JSON.stringify(opts.filter));
  } else {
    throw new Error("remxRetrieve: 必须提供 query 或 filter");
  }

  if (opts.limit) args.push("--limit", String(opts.limit));
  if (opts.noEmbed) args.push("--no-embed");

  const raw = remx(args);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ─── 索引记忆 ────────────────────────────────────────────────────────────────

export interface IndexOptions {
  file: string;
  dedupThreshold?: number;
  noEmbed?: boolean;
}

/**
 * remx index — 索引单个记忆文件。
 */
export function remxIndex(opts: IndexOptions): { memory_id: string; chunk_count: number } | null {
  const args = ["index", opts.file, "--db", REMX_DB, "--meta", REMX_META];
  if (opts.dedupThreshold !== undefined) {
    args.push("--dedup-threshold", String(opts.dedupThreshold));
  }
  if (opts.noEmbed) args.push("--no-embed");

  const raw = remx(args);
  // 解析输出: "remx index: indexed {path}\n  memory_id: {path}\n  chunks: {n}"
  const memIdMatch = raw.match(/memory_id:\s*(.+)/);
  const chunkMatch = raw.match(/chunks:\s*(\d+)/);
  if (memIdMatch && chunkMatch) {
    return { memory_id: memIdMatch[1].trim(), chunk_count: parseInt(chunkMatch[1], 10) };
  }
  return null;
}

// ─── 软删除 / GC ─────────────────────────────────────────────────────────────

/**
 * remx gc --dry-run — 查看即将被清理的记忆。
 */
export function remxGcDryRun(): { expired: number; deprecated: number; deprecatedIds: string[] } {
  const raw = remx(["gc", "--db", REMX_DB, "--dry-run"]);
  const expiredMatch = raw.match(/expired memories:\s*(\d+)/);
  const deprecatedMatch = raw.match(/deprecated memories:\s*(\d+)/);
  const ids: string[] = [];
  const idLines = raw.split("\n").filter((l) => l.includes("category="));
  for (const line of idLines) {
    const m = line.match(/^\s*(.+?)\s+\(category=(.+?)\)/);
    if (m) ids.push(m[1].trim());
  }
  return {
    expired: expiredMatch ? parseInt(expiredMatch[1], 10) : 0,
    deprecated: deprecatedMatch ? parseInt(deprecatedMatch[1], 10) : 0,
    deprecatedIds: ids,
  };
}

/**
 * remx gc --purge — 执行清理。
 */
export function remxGcPurge(): { purgedMemories: number; purgedChunks: number } {
  const raw = remx(["gc", "--db", REMX_DB, "--purge"]);
  const memMatch = raw.match(/purged:\s*(\d+)\s*memories/);
  const chunkMatch = raw.match(/(\d+)\s*chunks removed/);
  return {
    purgedMemories: memMatch ? parseInt(memMatch[1], 10) : 0,
    purgedChunks: chunkMatch ? parseInt(chunkMatch[1], 10) : 0,
  };
}

// ─── 拓扑关系 ────────────────────────────────────────────────────────────────

/**
 * remx relate nodes — 列出所有拓扑节点。
 */
export function remxRelateNodes(category?: string): Array<{ id: string; category: string; chunk: string }> {
  const args = ["relate", "nodes", "--db", REMX_DB];
  if (category) args.push("--category", category);
  const raw = remx(args);
  // 输出格式: "nodeId [category] chunk text..."
  const nodes: Array<{ id: string; category: string; chunk: string }> = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(.+?)\s+\[(.+?)\]\s+(.*)/);
    if (m) nodes.push({ id: m[1], category: m[2], chunk: m[3] });
  }
  return nodes;
}

/**
 * remx relate insert — 插入拓扑关系。
 * @param nodeIds   逗号分隔的节点 ID（记忆 path）
 * @param relType   关系类型
 * @param roles     逗号分隔的角色（cause,effect）
 * @param context   上下文标签，默认 global
 */
export function remxRelateInsert(
  nodeIds: string,
  relType: string,
  roles?: string,
  context: string = "global"
): number | null {
  const args = [
    "relate", "insert",
    "--db", REMX_DB,
    "--nodes", nodeIds,
    "--rel-type", relType,
    "--context", context,
  ];
  if (roles) args.push("--roles", roles);
  const raw = remx(args);
  const m = raw.match(/rel_id=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * remx relate query — 查询某节点的关联关系。
 */
export function remxRelateQuery(nodeId: string, currentContext?: string): any[] {
  const args = ["relate", "query", "--db", REMX_DB, "--node-id", nodeId];
  if (currentContext) args.push("--current-context", currentContext);
  const raw = remx(args);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * remx relate graph — BFS 遍历从某节点出发的关联图。
 */
export function remxRelateGraph(nodeId: string, currentContext?: string, maxDepth: number = 2): any[] {
  const args = [
    "relate", "graph",
    "--db", REMX_DB,
    "--node-id", nodeId,
    "--max-depth", String(maxDepth),
  ];
  if (currentContext) args.push("--current-context", currentContext);
  const raw = remx(args);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * remx relate delete — 删除拓扑关系。
 */
export function remxRelateDelete(relId: number): boolean {
  const raw = remx(["relate", "delete", "--db", REMX_DB, "--rel-id", String(relId)]);
  return raw.includes("deleted") || raw.includes("OK");
}

// ─── 统计 ────────────────────────────────────────────────────────────────────

export interface Stats {
  total: number;
  deprecated: number;
  byCategory: Record<string, number>;
}

/**
 * remx stats — 数据库统计。
 */
export function remxStats(): Stats {
  const raw = remx(["stats", "--db", REMX_DB]);
  const totalMatch = raw.match(/total memories \(active\):\s*(\d+)/);
  const depMatch = raw.match(/total memories \(deprecated\):\s*(\d+)/);
  const byCategory: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(.+?):\s*(\d+)/);
    if (m && m[1] !== "total memories (active)" && m[1] !== "total memories (deprecated)") {
      byCategory[m[1]] = parseInt(m[2], 10);
    }
  }
  return {
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    deprecated: depMatch ? parseInt(depMatch[1], 10) : 0,
    byCategory,
  };
}

// ─── 辅助：格式化摘要 ────────────────────────────────────────────────────────

export interface MemoryOpSummary {
  recalled?: string[];
  created?: string;
  updated?: string;
  topology?: string;
}

export function formatSummary(op: MemoryOpSummary): string {
  const parts: string[] = [];
  if (op.recalled && op.recalled.length > 0) {
    parts.push(`📚 召回: ${op.recalled.join(", ")}`);
  }
  if (op.created) {
    parts.push(`🆕 新建: ${op.created}`);
  }
  if (op.updated) {
    parts.push(`🔄 更新: ${op.updated}`);
  }
  if (op.topology) {
    parts.push(`🔗 拓扑: ${op.topology}`);
  }
  if (parts.length === 0) return "";
  return `---\n${parts.join("\n")}`;
}
