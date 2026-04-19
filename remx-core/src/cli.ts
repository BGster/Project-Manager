#!/usr/bin/env node
/**
 * remx CLI — @remx/cli entry point
 *
 * Usage:
 *   remx relate nodes   --db ./memory.db
 *   remx relate insert  --db ./memory.db --nodes a,b --rel-type 因果关系
 *   remx relate delete  --db ./memory.db --rel-id 1
 *   remx relate query   --db ./memory.db --node-id xxx
 *   remx relate graph   --db ./memory.db --node-id xxx --max-depth 2
 *   remx init          --db ./memory.db --meta ./meta.yaml [--reset]
 *   remx stats         --db ./memory.db [--meta ./meta.yaml]
 *   remx parse         --meta ./meta.yaml
 *   remx gc            --db ./memory.db [--scope-path <path>] [--dry-run] [--purge]
 *   remx retrieve      --db ./memory.db [--filter '<json>'] [--query "..."] [--limit 50]
 */
import { Command } from "commander";
import { makeRelateCommand } from "./commands/relate";
import { makeInitCommand } from "./commands/init";
import { makeStatsCommand } from "./commands/stats";
import { makeParseCommand } from "./commands/parse";
import { makeGcCommand } from "./commands/gc";
import { makeRetrieveCommand } from "./commands/retrieve";
import { makeIndexCommand } from "./commands/index";

const VERSION = "0.3.0";

async function main() {
  const program = new Command();

  program
    .name("remx")
    .version(VERSION)
    .description("RemX unified memory system — CLI");

  program.addCommand(makeRelateCommand());
  program.addCommand(makeInitCommand());
  program.addCommand(makeStatsCommand());
  program.addCommand(makeParseCommand());
  program.addCommand(makeGcCommand());
  program.addCommand(makeRetrieveCommand());
  program.addCommand(makeIndexCommand());

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(`remx: ${err.message}`);
  process.exit(1);
});
