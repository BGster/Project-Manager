/**
 * MemoryManager — intelligent memory orchestration layer
 *
 * Responsibilities:
 * - Analyze incoming content to understand intent and relevant memory categories
 * - Decide which memories to recall based on content analysis
 * - Determine if content warrants create / update / merge / discard
 * - Coordinate ContextAssembler, ChunkSplitter, and MemoryFileManager
 *
 * This is the "brain" of the skill layer — the orchestrator that decides
 * what to remember, what to update, and what to leave alone.
 */
import { existsSync } from "fs";
import { assemble, byCategory, byFilter, AssembleOptions } from "./context-assembler";
import { validate, advise, ChunkPreview } from "./chunk-splitter";
import { write, update, remove, parseFrontMatter, MemoryFileOptions } from "./memory-file-manager";
import { check, summarize, DecayWarning } from "./decay-watcher";

export * from "./context-assembler";
export * from "./chunk-splitter";
export * from "./decay-watcher";
export * from "./memory-file-manager";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ManagerConfig {
  dbPath: string;
  metaPath?: string;
  indexScope?: string;          // root path for memory files
  defaultCategory?: string;     // fallback category if none detected
  autoIndex?: boolean;           // auto `remx index` after write (default: true)
  decayWarningEnabled?: boolean; // check decay on manage (default: true)
}

export interface AnalyzeResult {
  /** What type of memory operation is this? */
  intent: "create" | "update" | "merge" | "confirm" | "query" | "ignore";
  /** Detected category (demand/issue/principle/knowledge/tmp) */
  category?: string;
  /** Extracted or suggested title */
  title?: string;
  /** Keywords for semantic recall */
  keywords: string[];
  /** IDs of relevant existing memories (from recall) */
  relevantMemoryIds: string[];
  /** Why we decided this intent */
  reasoning: string;
  /** Confidence 0-1 */
  confidence: number;
}

export interface ManageDecision {
  /** What to do */
  action: "write" | "update" | "merge" | "skip" | "query_only";
  /** Target file path (for write/update) */
  targetPath?: string;
  /** Memory IDs to update or merge from */
  memoryIds: string[];
  /** The final content to write */
  content?: string;
  /** The final front-matter */
  frontMatter?: Partial<MemoryFileOptions>;
  /** Natural language explanation */
  reason: string;
}

export interface ManageResult {
  decision: ManageDecision;
  analyze: AnalyzeResult;
  /** Context text from recalled memories (for LLM consumption) */
  recalledContext: string;
  /** Decay warnings triggered */
  decayWarnings: DecayWarning[];
  /** Files written/updated (if any) */
  filesChanged: string[];
}

// ─── Intent Detection ────────────────────────────────────────────────────────

const CREATE_TRIGGERS = [
  "记住", "记录", "这是个决定", "我要定下来", "决定是",
  "政策是", "规范是", "原则是", "新增", "新建",
];

const UPDATE_TRIGGERS = [
  "更新", "修改", "改为", "改成", "调整", "变更",
  "之前说过", "我改变主意", "纠正", "补充",
];

const MERGE_TRIGGERS = [
  "合并", "整合", "统一", "汇总", "归并",
];

const QUERY_TRIGGERS = [
  "之前", "过去", "我记得", "有没有", "列出",
  "哪些", "什么决定", "怎么做的", "为什么",
];

const CONFIRM_TRIGGERS = [
  "确认", "收到", "好的", "知道了", "对", "是的",
];

function detectIntent(text: string): { intent: AnalyzeResult["intent"]; confidence: number } {
  const t = text.toLowerCase();

  // Query first — these don't create memories
  for (const q of QUERY_TRIGGERS) {
    if (t.includes(q)) return { intent: "query", confidence: 0.8 };
  }

  // Check for updates / merges with high confidence
  for (const u of UPDATE_TRIGGERS) {
    if (t.includes(u)) return { intent: "update", confidence: 0.85 };
  }
  for (const m of MERGE_TRIGGERS) {
    if (t.includes(m)) return { intent: "merge", confidence: 0.8 };
  }
  for (const c of CONFIRM_TRIGGERS) {
    if (t.includes(c) && t.length < 50) return { intent: "confirm", confidence: 0.9 };
  }
  for (const c of CREATE_TRIGGERS) {
    if (t.includes(c)) return { intent: "create", confidence: 0.75 };
  }

  // Default to create if content is substantial and not a short query
  if (text.length > 100) return { intent: "create", confidence: 0.5 };
  return { intent: "query", confidence: 0.4 };
}

function detectCategory(text: string): string | undefined {
  const t = text.toLowerCase();

  const categorySignals: Record<string, string[]> = {
    demand: ["决定", "需求", "feature", "应该要", "我们采用", "方案", "选型"],
    issue: ["bug", "问题", "错误", "修复", "issue", "事故", "风险"],
    principle: ["原则", "规范", "政策", "必须", "禁止", "规范是", "做法是"],
    knowledge: ["学习", "知识", "技巧", "了解", "概念", "什么是", "怎么理解"],
    tmp: ["临时", "草稿", "待办", "TODO", "周报", "会议纪要"],
  };

  let best: string | undefined;
  let bestScore = 0;

  for (const [cat, signals] of Object.entries(categorySignals)) {
    let score = 0;
    for (const sig of signals) {
      if (t.includes(sig.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  return bestScore > 0 ? best : undefined;
}

function extractKeywords(text: string): string[] {
  // Simple keyword extraction — remove common words, get nouns/verbs
  const stopWords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
    "自己", "这", "那", "它", "他", "她", "们", "这个", "那个", "什么", "怎么",
    "的", "了", "和", "与", "或", "但", "如果", "因为", "所以", "但是", "而是",
  ]);

  const words = text
    .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()));

  // Return top keywords (simple frequency)
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

function extractTitle(text: string): string | undefined {
  // Try to find a title-like pattern: "## title" or "# title" or "title:"
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines.slice(0, 5)) {
    const m = line.match(/^#+\s+(.+)$/);
    if (m) return m[1].trim();

    const colon = line.match(/^(.{3,50}):\s*$/);
    if (colon && !line.includes("http")) return colon[1].trim();
  }

  // Use first meaningful line as title
  for (const line of lines.slice(0, 3)) {
    if (line.length > 5 && line.length < 80 && !line.startsWith("-") && !line.startsWith("*")) {
      return line.slice(0, 60);
    }
  }

  return undefined;
}

// ─── Recall ─────────────────────────────────────────────────────────────────

async function recallRelevantMemories(
  text: string,
  keywords: string[],
  config: ManagerConfig
): Promise<{ ids: string[]; context: string }> {
  if (!existsSync(config.dbPath)) {
    return { ids: [], context: "" };
  }

  const opts: AssembleOptions = {
    dbPath: config.dbPath,
    metaPath: config.metaPath,
    limit: 10,
  };

  let context = "";

  // Try semantic query first
  if (keywords.length > 0) {
    const queryText = keywords.slice(0, 5).join(" ");
    try {
      context = assemble(queryText, opts);
    } catch {
      context = "";
    }
  }

  // Also try direct category recall
  const category = detectCategory(text);
  if (category) {
    try {
      const catContext = byCategory(category, opts);
      // Merge (avoid duplication)
      if (catContext && catContext !== context) {
        context = context ? context + "\n\n---\n\n" + catContext : catContext;
      }
    } catch {
      // ignore
    }
  }

  // Extract IDs from context (simple pattern: look for lines with IDs)
  const idSet = new Set<string>();
  const idRe = /[A-Z]+-\w+/g;
  let match;
  while ((match = idRe.exec(context)) !== null) {
    idSet.add(match[0]);
  }

  return {
    ids: [...idSet],
    context,
  };
}

// ─── Update Decision ─────────────────────────────────────────────────────────

function shouldUpdate(
  text: string,
  existingIds: string[],
  config: ManagerConfig
): { action: ManageDecision["action"]; targetIds: string[]; reason: string } {
  // No relevant memories → create new
  if (existingIds.length === 0) {
    return { action: "write", targetIds: [], reason: "没有找到相关记忆，适合创建新记忆" };
  }

  // Multiple relevant → merge or query
  if (existingIds.length >= 3) {
    return {
      action: "merge",
      targetIds: existingIds.slice(0, 5),
      reason: `发现 ${existingIds.length} 条相关记忆，考虑整合`,
    };
  }

  // Short query → just recall
  if (detectIntent(text).intent === "query") {
    return { action: "query_only", targetIds: existingIds, reason: "用户查询，仅召回相关记忆" };
  }

  // Short confirm → skip
  if (detectIntent(text).intent === "confirm") {
    return { action: "skip", targetIds: existingIds, reason: "确认类消息，不需要创建或更新记忆" };
  }

  // 1-2 relevant memories → update the most relevant
  return {
    action: "update",
    targetIds: existingIds.slice(0, 2),
    reason: `发现 ${existingIds.length} 条相关记忆，建议更新`,
  };
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * Analyze content and decide what to do with memories.
 * 
 * This is the main entry point for the Manager module.
 * 
 * @param text - The user's input text or content to analyze
 * @param config - Manager configuration (dbPath required)
 * @returns ManageResult with decision, analysis, recalled context
 */
export async function analyzeContent(
  text: string,
  config: ManagerConfig
): Promise<AnalyzeResult> {
  const { intent, confidence } = detectIntent(text);
  const category = detectCategory(text) || config.defaultCategory;
  const keywords = extractKeywords(text);
  const title = extractTitle(text);

  // Recall relevant memories
  const { ids, context: _context } = await recallRelevantMemories(text, keywords, config);

  let reasoning: string;
  switch (intent) {
    case "create":
      reasoning = `检测到创建意图，提取到 ${keywords.length} 个关键词`;
      if (category) reasoning += `，推断 category=${category}`;
      break;
    case "update":
      reasoning = `检测到更新意图，建议更新相关记忆`;
      break;
    case "merge":
      reasoning = `检测到合并意图，涉及 ${ids.length} 条相关记忆`;
      break;
    case "query":
      reasoning = `检测到查询意图，召回相关记忆`;
      break;
    case "confirm":
      reasoning = `检测到确认，无需创建或更新记忆`;
      break;
    default:
      reasoning = "无法判断意图，作为查询处理";
  }

  return {
    intent,
    category,
    title,
    keywords,
    relevantMemoryIds: ids,
    reasoning,
    confidence,
  };
}

/**
 * Full memory management decision pipeline.
 * 
 * 1. Analyze content → detect intent + category + keywords
 * 2. Recall relevant memories
 * 3. Decide action (write/update/merge/skip/query_only)
 * 4. If action needs file change, prepare content + front-matter
 * 
 * @param text - The user's input text
 * @param config - Manager configuration
 * @param writeOptions - Optional front-matter for write/update actions
 */
export async function manage(
  text: string,
  config: ManagerConfig,
  writeOptions?: Partial<MemoryFileOptions>
): Promise<ManageResult> {
  // Step 1: Analyze
  const analyze = await analyzeContent(text, config);

  // Step 2: Recall
  const { ids, context: recalledContext } = await recallRelevantMemories(
    text,
    analyze.keywords,
    config
  );
  analyze.relevantMemoryIds = ids;

  // Step 3: Decide
  const { action, targetIds, reason } = shouldUpdate(text, ids, config);

  // Step 4: Check decay
  let decayWarnings: DecayWarning[] = [];
  if (config.decayWarningEnabled !== false && existsSync(config.dbPath) && config.metaPath) {
    try {
      decayWarnings = check(config.metaPath, config.dbPath);
    } catch {
      // ignore
    }
  }

  // Step 5: Prepare file operation if needed
  let decision: ManageDecision = {
    action,
    memoryIds: targetIds,
    reason,
  };

  const filesChanged: string[] = [];

  if (action === "write" || action === "update") {
    const effectiveCategory = analyze.category || writeOptions?.category || config.defaultCategory || "knowledge";
    const effectiveTitle = analyze.title || writeOptions?.title || "未命名记忆";

    const fm: Partial<MemoryFileOptions> = {
      category: effectiveCategory,
      title: effectiveTitle,
      ...writeOptions,
    };

    // For update, append new content to existing
    if (action === "update" && targetIds.length > 0 && config.dbPath) {
      // Try to read existing content from recalled context
      // The manager will coordinate the actual update
    }

    decision = {
      action,
      memoryIds: targetIds,
      targetPath: writeOptions?.filePath,
      frontMatter: fm,
      content: action === "write" ? text : undefined,
      reason,
    };
  }

  return {
    decision,
    analyze,
    recalledContext,
    decayWarnings,
    filesChanged,
  };
}

/**
 * Execute a memory write/update decision.
 * Call this after `manage()` when decision.action is "write" or "update".
 */
export async function executeDecision(
  decision: ManageDecision,
  config: ManagerConfig
): Promise<ManageResult> {
  const filesChanged: string[] = [];

  if (decision.action === "write" && decision.content && decision.frontMatter) {
    const result = write({
      ...decision.frontMatter,
      content: decision.content,
      filePath: decision.targetPath,
      dbPath: config.dbPath,
      metaPath: config.metaPath,
    } as MemoryFileOptions);
    filesChanged.push(result.filePath);

    // Auto-index if enabled
    if (config.autoIndex !== false) {
      await runIndex(result.filePath, config);
    }
  }

  if (decision.action === "update" && decision.memoryIds.length > 0 && decision.frontMatter) {
    for (const memoryId of decision.memoryIds) {
      // We need the file path — in a real impl, look up by memoryId
      // For now, the agent handles the file path lookup
    }
  }

  return {
    decision,
    analyze: { intent: decision.action as any, reasoning: "executed", keywords: [], relevantMemoryIds: decision.memoryIds, confidence: 1 },
    recalledContext: "",
    decayWarnings: [],
    filesChanged,
  };
}

/**
 * Run remx index on a file (fire-and-forget)
 */
async function runIndex(filePath: string, config: ManagerConfig): Promise<void> {
  if (!existsSync(config.dbPath) || !config.metaPath) return;

  try {
    const { execSync } = require("child_process");
    const metaPath = config.metaPath;
    const dbPath = config.dbPath;
    execSync(
      `node /home/claw/RemX/remx-core/dist/cli.js index "${filePath}" --db "${dbPath}" --meta "${metaPath}"`,
      { encoding: "utf-8", timeout: 30000 }
    );
  } catch {
    // Index failures are non-fatal — file is written, indexing can be retried
  }
}

/**
 * Summarize decay warnings as readable text.
 */
export function decaySummary(): string {
  // This requires dbPath + metaPath — caller must provide
  return "";
}
