/**
 * remx index command — index a single file into memories + chunks + memories_vec.
 *
 * Usage:
 *   remx index <file> --db <path> --meta <path> [--dedup-threshold <float>] [--no-embed]
 */

import { Command } from "commander";
import { runIndex, type IndexConfig } from "../core/index";
import { createEmbedderFromConfig, type Embedder } from "../core/embedder";
import { MetaYamlModel } from "../core/schema";

export function makeIndexCommand(): Command {
  const cmd = new Command("index");
  cmd
    .description("index a file into memory")
    .argument("<file>", "file to index")
    .requiredOption("--db <path>", "database path")
    .requiredOption("--meta <path>", "meta.yaml path")
    .option("--dedup-threshold <float>", "semantic dedup threshold (0.0-1.0)")
    .option("--no-embed", "skip embedding generation")
    .action(async (file: string, opts: Record<string, unknown>) => {
      // Load meta.yaml
      const metaPath = opts.meta as string;
      const dbPath = opts.db as string;

      const meta = MetaYamlModel.load(metaPath);

      // Create embedder if not --no-embed
      let embedder: Embedder | undefined = undefined;
      if (!opts.noEmbed && meta.embedder) {
        const created = createEmbedderFromConfig(meta.embedder);
        if (created !== null) embedder = created;
      }

      const config: IndexConfig = {
        maxTokens: meta.chunk.max_tokens,
        overlap: meta.chunk.overlap,
        strategy: meta.chunk.strategy as "heading" | "paragraph",
        headingLevels: meta.chunk.heading_levels,
        dedupThreshold: opts.dedupThreshold != null
          ? parseFloat(opts.dedupThreshold as string)
          : undefined,
      };

      const result = await runIndex({
        filePath: file,
        metaYamlPath: metaPath,
        dbPath,
        config,
        embedder,
        dedupThreshold: config.dedupThreshold,
      });

      console.log(`remx index: indexed ${file}`);
      console.log(`  memory_id: ${result.memoryId}`);
      console.log(`  category: ${result.category}`);
      console.log(`  chunks: ${result.chunkCount}`);
      if (result.expiresAt) {
        console.log(`  expires_at: ${result.expiresAt}`);
      }
    });

  return cmd;
}
