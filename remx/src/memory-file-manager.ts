/**
 * MemoryFileManager — manages memory file lifecycle
 *
 * Responsibilities:
 * - Write/update/delete memory markdown files with YAML front-matter
 * - Trigger remx index to index files
 * - Trigger remx gc --purge for deleted files
 */
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from "fs";
import { dirname } from "path";
import YAML from "yaml";

export interface MemoryFileOptions {
  category: string;
  title: string;
  content: string;
  id?: string;
  priority?: string;
  status?: string;
  type?: string;
  tags?: string[];
  userId?: string;
  createdAt?: string;
  expiresAt?: string;
  filePath?: string;
  dbPath?: string;
  metaPath?: string;
}

export interface MemoryFileResult {
  filePath: string;
  memoryId?: string;
  chunkCount?: number;
}

/**
 * Write a new memory file with YAML front-matter
 */
export function write(options: MemoryFileOptions): MemoryFileResult {
  const { category, title, content, id, priority, status, type, tags, userId, createdAt, expiresAt } = options;

  // Determine file path
  const filePath = options.filePath || defaultPathForCategory(category, title);

  // Ensure directory exists
  mkdirSync(dirname(filePath), { recursive: true });

  const now = new Date().toISOString();
  const frontMatter: Record<string, any> = {
    title,
    category,
  };
  if (id) frontMatter.id = id;
  if (priority) frontMatter.priority = priority;
  if (status) frontMatter.status = status;
  if (type) frontMatter.type = type;
  if (tags) frontMatter.tags = tags;
  if (userId) frontMatter.user_id = userId;
  frontMatter.created_at = createdAt || now;
  frontMatter.updated_at = now;
  if (expiresAt) frontMatter.expires_at = expiresAt;

  const fmYaml = YAML.stringify(frontMatter).trim();
  const markdown = `---\n${fmYaml}\n---\n\n# ${title}\n\n${content}`;

  writeFileSync(filePath, markdown, "utf-8");

  return { filePath };
}

/**
 * Update an existing memory file
 */
export function update(filePath: string, updates: Partial<MemoryFileOptions>): MemoryFileResult {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const text = readFileSync(filePath, "utf-8");
  const { body } = parseFrontMatter(text);

  // Merge updates
  if (updates.content) {
    // For updates, append to existing content
    updates.content = body + "\n\n" + updates.content;
  }

  return write({ ...updates, filePath } as MemoryFileOptions);
}

/**
 * Delete a memory file and purge from index
 */
export function remove(filePath: string): void {
  if (!existsSync(filePath)) return; // Already gone

  unlinkSync(filePath);
  // Note: remx gc --purge --scope would be called by the agent after this
}

/**
 * Check if a memory file exists
 */
export function exists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Parse front-matter from markdown text
 */
export function parseFrontMatter(text: string): { frontMatter: Record<string, any>; body: string } {
  if (!text.startsWith("---")) return { frontMatter: {}, body: text };
  const end = text.indexOf("---", 3);
  if (end === -1) return { frontMatter: {}, body: text };
  const fmText = text.slice(3, end).trim();
  const body = text.slice(end + 3).trimStart();
  try {
    const fm = YAML.parse(fmText) || {};
    return { frontMatter: fm, body };
  } catch {
    return { frontMatter: {}, body: text };
  }
}

/**
 * Get default file path for a category
 */
function defaultPathForCategory(category: string, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dirs: Record<string, string> = {
    demand: "demands",
    issue: "issues",
    principle: "principles",
    knowledge: "knowledge",
    tmp: "tmp",
  };
  const dir = dirs[category] || "memory";
  return `${dir}/${slug}.md`;
}
