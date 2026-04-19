/**
 * DecayWatcher — monitors memory decay and issues warnings
 *
 * Responsibilities:
 * - Load decay_groups from meta.yaml
 * - Check memories near expiration
 * - Generate urgency warnings
 */
import { existsSync } from "fs";

export interface DecayWarning {
  memoryId: string;
  category: string;
  title?: string;
  expiresAt?: string;
  staleAt?: string;
  remainingHours: number;
  urgency: "critical" | "high" | "normal";
}

export interface DecayWatcherConfig {
  warnBeforeHours?: number;
  criticalHours?: number;
}

// Types
interface DecayGroupConfig {
  name: string;
  trigger?: { category?: string; status?: string };
  function: string;
  params?: Record<string, any>;
}

interface MemoryRecord {
  id: string;
  category: string;
  title?: string;
  expires_at?: string;
}

/**
 * Check all memories for upcoming decay
 */
export function check(
  metaYamlPath: string,
  dbPath: string,
  config?: DecayWatcherConfig
): DecayWarning[] {
  if (!existsSync(dbPath)) return [];

  const warnings: DecayWarning[] = [];
  const warnBeforeHours = config?.warnBeforeHours || 24;
  const criticalHours = config?.criticalHours || 4;

  // Load meta.yaml decay_groups
  let decayGroups: DecayGroupConfig[] = [];
  try {
    const { readFileSync } = require("fs");
    const YAML = require("yaml");
    const text = readFileSync(metaYamlPath, "utf-8");
    const meta = YAML.parse(text);
    decayGroups = meta.decay_groups || [];
  } catch {
    // Use default decay groups
    decayGroups = [
      { name: "tmp_default", trigger: { category: "tmp" }, function: "ttl", params: { ttl_hours: 24 } },
      { name: "demand_default", trigger: { category: "demand" }, function: "stale_after", params: { days: 90 } },
      { name: "issue_default", trigger: { category: "issue" }, function: "stale_after", params: { days: 60 } },
    ];
  }

  // For each decay group, query memories
  for (const dg of decayGroups) {
    if (dg.function === "never") continue;

    const filter: Record<string, any> = {};
    if (dg.trigger?.category) filter.category = dg.trigger.category;

    // Get memories with expires_at in range
    const records = queryMemoriesWithExpiry(dbPath, filter);

    for (const rec of records) {
      const expiresAt = rec.expires_at;
      if (!expiresAt) continue;

      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      const remainingHours = remainingMs / (1000 * 60 * 60);

      if (remainingHours <= 0) continue; // Already expired

      let urgency: DecayWarning["urgency"];
      if (remainingHours <= criticalHours) urgency = "critical";
      else if (remainingHours <= warnBeforeHours) urgency = "high";
      else if (remainingHours <= 72) urgency = "normal";
      else continue;

      warnings.push({
        memoryId: rec.id,
        category: rec.category,
        title: rec.title,
        expiresAt,
        remainingHours: Math.round(remainingHours * 10) / 10,
        urgency,
      });
    }
  }

  // Sort by urgency then remaining hours
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, normal: 2 };
  warnings.sort((a, b) => {
    const u = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (u !== 0) return u;
    return a.remainingHours - b.remainingHours;
  });

  return warnings;
}

/**
 * Summarize warnings as readable text
 */
export function summarize(warnings: DecayWarning[]): string {
  if (warnings.length === 0) {
    return "没有即将衰减的记忆。";
  }

  const lines: string[] = [];
  lines.push(`⚠️ 记忆即将衰减（${warnings.length} 条）`);
  lines.push("");

  const emoji: Record<string, string> = { critical: "🔴", high: "🟡", normal: "🟢" };

  for (const w of warnings) {
    const e = emoji[w.urgency] || "⚪️";
    const type = w.expiresAt ? "TTL" : "stale_after";
    lines.push(`${e} [${w.urgency}] ${w.memoryId}${w.title ? ` "${w.title}"` : ""} — 剩余 ${w.remainingHours}h (${type})`);
  }

  lines.push("");
  lines.push("如需保留，请更新文件后重新 index 以刷新 TTL。");

  return lines.join("\n");
}

/**
 * Query memories with expiry info
 */
function queryMemoriesWithExpiry(dbPath: string, filter: Record<string, any>): MemoryRecord[] {
  try {
    // Use direct SQLite query via better-sqlite3
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    let sql = "SELECT id, category, expires_at FROM memories WHERE deprecated = 0 AND expires_at IS NOT NULL";
    const params: any[] = [];

    if (filter.category) {
      sql += " AND category = ?";
      params.push(filter.category);
    }

    sql += " ORDER BY expires_at ASC LIMIT 100";
    const rows = db.prepare(sql).all(...params) as MemoryRecord[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}
