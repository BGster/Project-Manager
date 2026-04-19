/**
 * RemX Plugin Entry Point
 *
 * Hooks: before_prompt_build
 *
 * Architecture: plugin delegates all memory operations to `remx` CLI.
 * No direct require() of core modules — fully decoupled via subprocess.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PluginApi {
  registerHook(events: string[], handler: (event: any) => Promise<void>, opts?: Record<string, any>): void;
}

// ─── CLI Caller ────────────────────────────────────────────────────────────────

function callRemx(args: string[], cwd?: string): string {
  const remxBin = resolve(__dirname, "../../remx-core/dist/cli.js");
  const result = spawnSync("node", [remxBin, ...args], {
    cwd: cwd || process.cwd(),
    encoding: "utf-8",
    timeout: 15000,
  });
  if (result.status !== 0) {
    console.error(`[remx] cli error: ${result.stderr}`);
    return "";
  }
  return result.stdout.trim();
}

// ─── Path Helpers ─────────────────────────────────────────────────────────────

function expandPath(p: string): string {
  if (p.startsWith("~/") || p.includes("${HOME}")) {
    return p.replace("~", homedir()).replace("${HOME}", homedir());
  }
  return p;
}

// ─── before_prompt_build Handler ───────────────────────────────────────────────

async function beforePromptBuildHandler(event: any): Promise<{ prependContext: string } | void> {
  const _ts = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T');
  require("fs").appendFileSync("/tmp/remx-plugin-call.log", _ts + " [BEFORE_PROMPT] triggered\n");

  // TODO:
  // 1. Extract user prompt from event.prompt
  // 2. Call `remx retrieve --db <path> --query "<prompt>" --limit 5`
  // 3. If results found, return { prependContext: "..." }
  // 4. If no results, return void
}

// ─── Plugin Registration ─────────────────────────────────────────────────────

export default {
  id: "remx",
  name: "RemX",

  register(api: PluginApi) {
    (api as any).on("before_prompt_build", beforePromptBuildHandler);
    console.log("[remx] Hook registered: before_prompt_build");
  },
};
