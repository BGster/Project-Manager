/**
 * commands/stats.ts
 * remx stats — show memory statistics
 *
 * Usage:
 *   remx stats --db <path> [--meta <path>]
 */
import { Command } from "commander";
import { join } from "path";
import Database from "better-sqlite3";

export function makeStatsCommand(): Command {
  const cmd = new Command("stats");
  cmd.description("show memory statistics (counts by category, db size, time range)");
  cmd.requiredOption("--db <path>", "path to SQLite database");
  cmd.option("--meta <path>", "path to meta.yaml (for reference only)");

  cmd.action(async (opts) => {
    const { db } = opts;
    const d = new Database(db);
    d.pragma("journal_mode = WAL");

    try {
      // Category counts
      const catRows = d
        .prepare(
          `SELECT category, COUNT(*) as cnt FROM memories WHERE deprecated = 0 GROUP BY category ORDER BY cnt DESC`
        )
        .all() as { category: string; cnt: number }[];

      // Total active memories
      const totalMem = (
        d.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE deprecated = 0`).get() as { cnt: number }
      ).cnt;

      // Total deprecated
      const totalDep = (
        d.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE deprecated = 1`).get() as { cnt: number }
      ).cnt;

      // Total chunks
      const totalChunks = (
        d
          .prepare(`SELECT COUNT(*) as cnt FROM chunks WHERE deprecated = 0`)
          .get() as { cnt: number }
      ).cnt;

      // Time range
      const earliest = d
        .prepare(`SELECT MIN(created_at) as min FROM memories`)
        .get() as { min: string | null };
      const latest = d
        .prepare(`SELECT MAX(updated_at) as max FROM memories`)
        .get() as { max: string | null };

      // DB file size
      let dbSize = 0;
      try {
        const { statSync } = await import("fs");
        const stat = statSync(db);
        dbSize = stat.size;
      } catch {
        // ignore
      }

      console.log(`=== RemX Statistics ===`);
      console.log(`database: ${db}`);
      console.log(`size: ${formatBytes(dbSize)}`);
      console.log(`total memories (active): ${totalMem}`);
      console.log(`total memories (deprecated): ${totalDep}`);
      console.log(`total chunks: ${totalChunks}`);
      if (earliest.min) console.log(`earliest memory: ${earliest.min}`);
      if (latest.max) console.log(`latest update: ${latest.max}`);
      console.log(`\nby category:`);
      if (catRows.length === 0) {
        console.log(`  (no memories)`);
      } else {
        for (const row of catRows) {
          console.log(`  ${row.category}: ${row.cnt}`);
        }
      }
    } finally {
      d.close();
    }
  });

  return cmd;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
