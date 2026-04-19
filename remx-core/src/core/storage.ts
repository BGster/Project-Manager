/**
 * storage.ts
 * File storage with YAML front-matter for RemX v0.3.0 TS CLI.
 *
 * Ported from storage.py (Python) → TypeScript.
 */

import { readFileSync, appendFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import YAML from "yaml";

// ─── Front-matter parsing ─────────────────────────────────────────────────────

export interface ParseFrontMatterResult {
  frontMatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse YAML front-matter from markdown text.
 * Returns { frontMatter, body }.
 */
export function parseFrontMatter(text: string): ParseFrontMatterResult {
  if (!text.startsWith("---")) return { frontMatter: {}, body: text };
  const end = text.indexOf("---", 3);
  if (end === -1) return { frontMatter: {}, body: text };
  const fmText = text.slice(3, end).trim();
  const body = text.slice(end + 3).trimStart();
  // Simple YAML extraction for key: value pairs
  const fm: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(fmText);
    if (parsed && typeof parsed === "object") {
      Object.assign(fm, parsed);
    }
  } catch {
    // Fallback: regex-based key: value extraction
    for (const line of fmText.split("\n")) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2];
    }
  }
  return { frontMatter: fm, body };
}

// ─── Write memory file ────────────────────────────────────────────────────────

export interface WriteMemoryFileOptions {
  category?: string;
  priority?: string;
  status?: string;
  tags?: string[];
  extension?: Record<string, unknown>;
  userId?: string;
  createdAt?: string;
  expiresAt?: string;
  type?: string;
  id?: string;
}

/**
 * Write a memory file with YAML front-matter.
 */
export function writeMemoryFile(
  filePath: string,
  title: string,
  content: string,
  options: WriteMemoryFileOptions = {},
): void {
  // Ensure parent directory exists
  const parentDir = dirname(filePath);
  try {
    require("fs").mkdirSync(parentDir, { recursive: true });
  } catch {
    // ignore
  }

  const now = new Date().toISOString();

  const fm: Record<string, unknown> = {};
  fm["title"] = title;
  if (options.id) fm["id"] = options.id;
  if (options.category) fm["category"] = options.category;
  if (options.priority) fm["priority"] = options.priority;
  fm["status"] = options.status ?? "open";
  if (options.tags) fm["tags"] = options.tags;
  if (options.extension) fm["extension"] = options.extension;
  if (options.userId) fm["user_id"] = options.userId;
  fm["created_at"] = options.createdAt ?? fm["created_at"] ?? now;
  fm["updated_at"] = now;
  if (options.expiresAt) fm["expires_at"] = options.expiresAt;
  if (options.type) fm["type"] = options.type;

  const fmYaml = YAML.stringify(fm, { indent: 2 }).trimEnd();

  const lines: string[] = [
    "---",
    fmYaml,
    "---",
    "",
    `# ${title}`,
    "",
    content,
  ];

  writeFileSync(filePath, lines.join("\n"), "utf-8");
}

// ─── Append to daily log ─────────────────────────────────────────────────────

export interface AppendToDailyLogOptions {
  date?: string;
  createdAt?: string;
}

/**
 * Append a log entry to a daily log file.
 */
export function appendToDailyLog(
  filePath: string,
  timeStr: string,
  content: string,
): void {
  const parentDir = dirname(filePath);
  try {
    require("fs").mkdirSync(parentDir, { recursive: true });
  } catch {
    // ignore
  }

  const now = new Date().toISOString();

  let existingContent = "";
  let fm: Record<string, unknown> = {};

  try {
    existingContent = readFileSync(filePath, "utf-8");
    const parsed = parseFrontMatter(existingContent);
    fm = parsed.frontMatter as Record<string, unknown>;
    existingContent = parsed.body;
  } catch {
    // File doesn't exist yet
  }

  const entry = `## ${timeStr}\n- ${content}\n`;

  let newContent: string;
  if (existingContent.trim()) {
    newContent = existingContent.trimEnd() + "\n" + entry;
  } else {
    const dateStr = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";
    newContent = `# 开发日志 - ${dateStr}\n\n${entry}`;
  }

  fm["date"] = fm["date"] ?? (filePath.split("/").pop()?.replace(/\.md$/, "") ?? "");
  fm["created_at"] = fm["created_at"] ?? now;

  const fmYaml = YAML.stringify(fm, { indent: 2 }).trimEnd();
  const lines = ["---", fmYaml, "---", "", newContent];

  writeFileSync(filePath, lines.join("\n"), "utf-8");
}
