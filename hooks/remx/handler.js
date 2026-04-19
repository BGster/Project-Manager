/**
 * RemX Memory Hook Handler v2
 *
 * Fully semantic — no trigger words, pure context analysis.
 * Analyzes BOTH user input and agent output to autonomously decide:
 *   - Whether to recall relevant memories (on user input)
 *   - Whether to create/update memories (on user input OR agent output)
 *
 * Results are appended to the agent's response so the user sees
 * what memories were touched.
 *
 * Events listened:
 *   - message:received  → analyze user input, decide recall/create
 *   - message:sent      → analyze agent output, decide create/update
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

// ─── Semantic Relevance Detection (no trigger words) ────────────────────────

/**
 * Is this text about project-related content that might need memory recall?
 * Detects: technical terms, project names, design discussions, decisions, issues.
 */
function isContextuallyRelevant(text, lastTopic = null) {
  if (!text || text.length < 20) return { relevant: false, reason: "too short" };

  const t = text.toLowerCase();

  // Technical/project signal patterns
  const relevanceSignals = [
    // Discussing architecture or design
    /\b(database|schema|api|service|module|component|architecture|design|pattern)\b/,
    /\b(实现|方案|设计|架构|模块|组件)\b/,
    // Asking about past decisions
    /\b(之前|过去|之前说|我记得|原来|当时的|最初)\b/,
    // Project-related questions
    /\b(我们|项目|产品|系统|代码|仓库|这个|那个|它)\b/,
    // Decision-related
    /\b(决定|选型|方案|采用|使用|选|定了|最终)\b/,
    // Problem-solving
    /\b(问题|bug|issue|修复|解决|错误|原因|为什么)\b/,
    // Planning
    /\b(计划|打算|准备|应该要|需要|待定)\b/,
  ];

  let signalCount = 0;
  for (const sig of relevanceSignals) {
    if (sig.test(t)) signalCount++;
  }

  // High relevance: multiple signals OR mentions lastTopic
  if (signalCount >= 2) return { relevant: true, reason: "multiple_signals", score: Math.min(0.9, 0.4 + signalCount * 0.15) };
  if (lastTopic && t.includes(lastTopic.toLowerCase())) return { relevant: true, reason: "topic_continuation", score: 0.7 };
  if (signalCount === 1 && text.length > 100) return { relevant: true, reason: "single_signal_long", score: 0.5 };

  return { relevant: false, reason: "no_signals", score: 0 };
}

/**
 * Is this content worth remembering as a new memory?
 * Detects: new decisions, conclusions, solutions, factual info not likely known.
 */
function isWorthRemembering(text) {
  if (!text || text.length < 50) return null;
  const t = text.toLowerCase();

  // Strong signals: explicit new information
  const strongSignals = [
    /决定是[:：]/, /最终方案[:：]/, /采用[:：]/, /选用[:：]/,
    /答案是[:：]/, /解决方案[:：]/, /修复方法[:：]/,
    /我们采用/, /我们将使用/, /选了/, /定了[:：]/,
    /这个决定/, /新的方案/, /新的做法/,
  ];

  for (const s of strongSignals) {
    if (s.test(t)) return { score: 0.9, reason: "explicit_decision", action: "create" };
  }

  // Medium signals: substantial explanation with new info
  const sentences = t.split(/[。！？；\n]/).filter(s => s.trim().length > 15);
  if (sentences.length >= 3) {
    const hasNewInfo = ["因为", "所以", "首先", "其次", "具体", "原理", "这样做的"].some(p => t.includes(p));
    if (hasNewInfo) return { score: 0.7, reason: "substantial_explanation", action: "create" };
  }

  // Update signals: correcting or modifying existing info
  const updateSignals = ["不是这样", "纠正一下", "更正", "之前不对", "修改为", "改为", "改成"];
  for (const s of updateSignals) {
    if (t.includes(s)) return { score: 0.85, reason: "correction", action: "update" };
  }

  return null;
}

// ─── Content Extraction ──────────────────────────────────────────────────────

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const texts = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        if (block.type === "text" && typeof block.text === "string") texts.push(block.text.trim());
        else if (block.content) { const sub = extractText(block.content); if (sub) texts.push(sub); }
      }
    }
    return texts.join("\n").trim();
  }
  if (content && typeof content === "object") {
    if (content.text) return String(content.text).trim();
    if (content.content) return extractText(content.content);
  }
  return String(content ?? "").trim();
}

// ─── Keyword Extraction ───────────────────────────────────────────────────────

function extractKeywords(text) {
  const stopWords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
    "自己", "这", "那", "它", "他", "她", "们", "什么", "怎么", "一个", "可以",
    "因为", "所以", "但是", "如果", "虽然", "而且", "或者", "还是",
  ]);
  const words = text.replace(/[^\w\u4e00-\u9fff\s]/g, " ").split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
}

// ─── RemX CLI Helpers ────────────────────────────────────────────────────────

function resolveRemxCli() {
  const local = "/home/claw/RemX/remx-core/dist/cli.js";
  if (existsSync(local)) return `node ${local}`;
  return "remx";
}

function remxRetrieve(query, dbPath, metaPath, limit = 5) {
  if (!dbPath || !existsSync(dbPath)) return [];
  try {
    const cli = resolveRemxCli();
    const meta = metaPath ? `--meta "${metaPath}"` : "";
    const cmd = `${cli} retrieve --db "${dbPath}" ${meta} --limit ${limit} --query "${query.replace(/"/g, '\\"')}"`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 15000 });
    return JSON.parse(out || "[]");
  } catch {
    return [];
  }
}

function remxIndex(filePath, dbPath, metaPath) {
  if (!dbPath || !metaPath || !existsSync(dbPath) || !existsSync(metaPath)) return;
  try {
    const cli = resolveRemxCli();
    execSync(`${cli} index "${filePath}" --db "${dbPath}" --meta "${metaPath}" --no-embed`, { encoding: "utf-8", timeout: 30000 });
  } catch {
    // non-fatal
  }
}

// ─── Memory Operations ────────────────────────────────────────────────────────

/**
 * Write a memory file and index it (fire-and-forget)
 */
function writeMemory(dbPath, metaPath, category, title, content) {
  try {
    const dir = dbPath.replace(/\/[^\/]+$/, "");
    const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const filePath = `${dir}/${category}/${slug}.md`;

    // Ensure directory exists
    try {
      const { mkdirSync } = require("node:fs");
      mkdirSync(`${dir}/${category}`, { recursive: true });
    } catch {}

    // Write markdown file with front-matter
    const now = new Date().toISOString();
    const fm = `category: ${category}\ntitle: "${title}"\ncreated_at: "${now}"\nupdated_at: "${now}"\nstatus: open`;
    const markdown = `---\n${fm}\n---\n\n# ${title}\n\n${content}`;

    require("node:fs").writeFileSync(filePath, markdown, "utf-8");

    // Index it
    remxIndex(filePath, dbPath, metaPath);

    return filePath;
  } catch (err) {
    return null;
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

const handler = async (event) => {
  if (event.type !== "message") return;

  const cfg = (event.context && event.context.cfg) || {};
  const hookCfg = cfg?.hooks?.internal?.entries?.["remx"] || {};
  const dbPath = expandPath(hookCfg.dbPath || "~/.openclaw/remx/remx.db");
  const metaPath = expandPath(hookCfg.metaPath || "~/.openclaw/remx/meta.yaml");
  const skipEmbed = hookCfg.skipEmbed ?? true;
  const minLen = hookCfg.minContentLength ?? 30;

  // Track what we did for the summary
  const ops = {
    recalled: [],  // memory IDs recalled
    created: [],    // memory IDs created
    updated: [],    // memory IDs updated
  };

  if (event.action === "received") {
    // ── User Message: Analyze + Decide recall ────────────────────────────────
    const content = extractText(event.context?.content);
    if (!content || content.length < minLen) return;

    // Check contextual relevance
    const relevance = isContextuallyRelevant(content, event.context?.lastTopic || null);

    // Also check if worth remembering from user input
    const worthRemembering = isWorthRemembering(content);

    if (relevance.relevant || worthRemembering) {
      // Extract keywords for recall
      const keywords = extractKeywords(content);
      const query = keywords.slice(0, 5).join(" ") || content.slice(0, 60);

      // Recall relevant memories
      const recalled = remxRetrieve(query, dbPath, metaPath, 5);

      if (recalled.length > 0) {
        for (const r of recalled) {
          if (r.id) ops.recalled.push(r.id);
        }

        // Build context for agent — inject recalled memories as system context
        // This gets added to the session context, not visible to user directly
        const contextLines = [
          "",
          "═══ REMX RECALL ═══",
          `Query: ${query}`,
          `Found ${recalled.length} relevant memory(ies):`,
        ];
        for (const r of recalled) {
          contextLines.push(`- [${r.id || "unknown"}] ${r.category || ""}: ${(r.content || "").slice(0, 150)}...`);
        }
        contextLines.push("═════════════════");

        // Inject as a system message that will be part of the conversation context
        event.messages.push({
          role: "system",
          content: contextLines.join("\n"),
        });
      }

      // If user input itself is worth remembering, save it
      if (worthRemembering && worthRemembering.score >= 0.8) {
        const title = content.slice(0, 50).replace(/[#*\n]/g, " ").trim();
        const category = detectCategory(content) || "knowledge";
        const path = writeMemory(dbPath, metaPath, category, title, content);
        if (path) {
          ops.created.push(path.split("/").pop().replace(".md", ""));
        }
      }

      // Update last topic for context continuation
      if (event.context) {
        event.context.lastTopic = keywords[0] || content.slice(0, 30);
      }
    }
  }

  if (event.action === "sent") {
    // ── Agent Output: Analyze + Decide create/update ────────────────────────
    const content = extractText(event.context?.content);
    if (!content || content.length < minLen * 2) return;

    const worthRemembering = isWorthRemembering(content);
    if (worthRemembering && worthRemembering.score >= 0.7) {
      const title = content.slice(0, 60).replace(/[#*\n]/g, " ").trim();
      const category = detectCategory(content) || "knowledge";

      if (worthRemembering.action === "update") {
        // This is a correction — find the relevant memory first
        const keywords = extractKeywords(content);
        const recalled = remxRetrieve(keywords.slice(0, 3).join(" "), dbPath, metaPath, 2);
        if (recalled.length > 0) {
          ops.updated.push(recalled[0].id);
        }
      }

      const path = writeMemory(dbPath, metaPath, category, title, content);
      if (path) {
        ops.created.push(path.split("/").pop().replace(".md", ""));
      }
    }
  }

  // ── Append summary to agent response ───────────────────────────────────
  if (ops.recalled.length > 0 || ops.created.length > 0 || ops.updated.length > 0) {
    const parts = [];
    if (ops.recalled.length > 0) {
      parts.push(`📚 召回: ${ops.recalled.slice(0, 5).join(", ")}`);
    }
    if (ops.created.length > 0) {
      parts.push(`🆕 新建: ${ops.created.slice(0, 5).join(", ")}`);
    }
    if (ops.updated.length > 0) {
      parts.push(`🔄 更新: ${ops.updated.slice(0, 5).join(", ")}`);
    }

    if (parts.length > 0) {
      event.messages.push({
        role: "assistant",
        content: `\n\n---\n${parts.join(" ｜ ")}`,
      });
    }
  }
};

function expandPath(p) {
  if (p.startsWith("~/") || p.includes("${HOME}")) {
    return p.replace("~", homedir()).replace("${HOME}", homedir());
  }
  return p;
}

function detectCategory(text) {
  const t = text.toLowerCase();
  const signals = {
    demand: ["决定", "需求", "feature", "应该要", "我们采用", "方案", "选型", "决定是"],
    issue: ["bug", "问题", "错误", "修复", "issue", "事故", "风险", "问题原因"],
    principle: ["原则", "规范", "政策", "必须", "禁止", "规范是", "做法是", "必须这样"],
    knowledge: ["学习", "知识", "技巧", "了解", "概念", "什么是", "怎么理解", "原理"],
    tmp: ["临时", "草稿", "待办", "TODO", "周报", "会议纪要", "稍后"],
  };
  let best = null, bestScore = 0;
  for (const [cat, sigs] of Object.entries(signals)) {
    let score = 0;
    for (const s of sigs) { if (t.includes(s.toLowerCase())) score++; }
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return bestScore > 0 ? best : "knowledge";
}

export default handler;
