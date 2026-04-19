/**
 * commands/parse.ts
 * remx parse — load and validate meta.yaml, output JSON
 *
 * Usage:
 *   remx parse --meta <path>
 */
import { Command } from "commander";
import { MetaYamlModel } from "../core/schema";

export function makeParseCommand(): Command {
  const cmd = new Command("parse");
  cmd.description("load and validate meta.yaml, output JSON");
  cmd.requiredOption("--meta <path>", "path to meta.yaml");

  cmd.action(async (opts) => {
    const { meta } = opts;
    try {
      const model = MetaYamlModel.load(meta);
      console.log(model.toJson());
    } catch (err) {
      console.error(`[remx] parse error: ${err}`);
      process.exit(1);
    }
  });

  return cmd;
}
