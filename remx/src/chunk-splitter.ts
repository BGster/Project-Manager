/**
 * ChunkSplitter — validates markdown structure and previews chunking
 *
 * Responsibilities:
 * - Validate heading hierarchy (no level skips)
 * - Check paragraph length vs max_tokens
 * - Check list integrity
 * - Preview chunking results
 */
import { readFileSync, existsSync } from "fs";
import { stripFrontMatter } from "./strip-front-matter";

export interface ValidationIssue {
  type: "heading_skip" | "section_too_long" | "list_integrity";
  line: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface Advice {
  type: "split_heading" | "merge_heading" | "shorten_paragraph";
  atLine: number;
  suggest: string;
  reason: string;
}

export interface ChunkPreview {
  chunkId: string;
  heading: string;
  headingLevel: number;
  paraIndices: number[];
  tokenCount: number;
  contentPreview: string;
}

/**
 * Validate a markdown file or content
 */
export function validate(filePathOrContent: string, options?: { maxTokens?: number; headingLevels?: number[] }): ValidationResult {
  const content = existsSync(filePathOrContent) ? readFileSync(filePathOrContent, "utf-8") : filePathOrContent;
  const { body } = stripFrontMatter(content);
  const lines = body.split("\n");
  const maxTokens = options?.maxTokens || 512;

  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let prevLevel = 0;
  let currentSectionTokens = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;

      // Check heading skip
      if (prevLevel > 0 && level > prevLevel + 1) {
        issues.push({
          type: "heading_skip",
          line: i + 1,
          message: `H${prevLevel} 后直接跳到 H${level}，缺少 H${prevLevel + 1}`,
        });
      }

      // Reset section token counter
      currentSectionTokens = 0;
      prevLevel = level;
    } else {
      // Count tokens in paragraph (rough estimate)
      const paraTokens = estimateTokens(line);
      currentSectionTokens += paraTokens;

      // Check section length
      if (currentSectionTokens > maxTokens) {
        warnings.push({
          type: "section_too_long",
          line: i + 1,
          message: `段落 token 数 (${currentSectionTokens}) 超过 max_tokens (${maxTokens})`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues, warnings };
}

/**
 * Get modification advice
 */
export function advise(filePathOrContent: string, options?: { maxTokens?: number }): Advice[] {
  const result = validate(filePathOrContent, options);
  const advice: Advice[] = [];

  for (const issue of result.issues) {
    if (issue.type === "heading_skip") {
      advice.push({
        type: "split_heading",
        atLine: issue.line,
        suggest: `在第 ${issue.line} 行前插入 H${issue.message.match(/H(\d+)/)?.[1]} 标题`,
        reason: issue.message,
      });
    }
  }

  for (const warning of result.warnings) {
    if (warning.type === "section_too_long") {
      advice.push({
        type: "shorten_paragraph",
        atLine: warning.line,
        suggest: "考虑在段落中插入子标题以切分内容",
        reason: warning.message,
      });
    }
  }

  return advice;
}

/**
 * Preview chunking results (simplified)
 */
export function preview(filePathOrContent: string, options?: { maxTokens?: number; strategy?: string }): ChunkPreview[] {
  const content = existsSync(filePathOrContent) ? readFileSync(filePathOrContent, "utf-8") : filePathOrContent;
  const { body } = stripFrontMatter(content);
  const lines = body.split("\n");
  const maxTokens = options?.maxTokens || 512;

  const chunks: ChunkPreview[] = [];
  let chunkIndex = 0;
  let currentChunkLines: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > maxTokens && currentChunkLines.length > 0) {
      const chunkText = currentChunkLines.join("\n");
      const headingMatch = chunkText.match(/^#+\s+(.+)$/m);
      chunks.push({
        chunkId: `preview::chunk::${chunkIndex}`,
        heading: headingMatch ? headingMatch[0] : "",
        headingLevel: headingMatch ? headingMatch[1].length : 0,
        paraIndices: [],
        tokenCount: currentTokens,
        contentPreview: chunkText.slice(0, 200) + (chunkText.length > 200 ? "..." : ""),
      });
      chunkIndex++;
      currentChunkLines = [];
      currentTokens = 0;
    }

    currentChunkLines.push(line);
    currentTokens += lineTokens;
  }

  // Final chunk
  if (currentChunkLines.length > 0) {
    const chunkText = currentChunkLines.join("\n");
    chunks.push({
      chunkId: `preview::chunk::${chunkIndex}`,
      heading: chunkText.match(/^#+\s+(.+)$/m)?.[0] || "",
      headingLevel: 0,
      paraIndices: [],
      tokenCount: currentTokens,
      contentPreview: chunkText.slice(0, 200) + (chunkText.length > 200 ? "..." : ""),
    });
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).length * 1.3);
}
