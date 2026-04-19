/**
 * chunker.ts
 * Chunking logic for RemX v0.3.0 TS CLI.
 *
 * Splits a markdown file into paragraphs, then groups paragraphs into chunks
 * respecting max_tokens (soft limit) with paragraph-level overlap.
 *
 * chunk_id format:
 *   global::{display_path}::{chunk_index}   -- global memory (~ or / prefix)
 *   project::{relative_path}::{chunk_index} -- project memory (relative path)
 *
 * Security: paths containing '..' are rejected to prevent directory escape.
 */

import { readFileSync } from "fs";
import { resolve, isAbsolute } from "path";

// ─── Path utilities ──────────────────────────────────────────────────────────

function _normalizePath(filePath: string): string {
  if (filePath.includes("..")) {
    throw new Error(`Path with '..' is not allowed: ${filePath}`);
  }
  if (filePath.startsWith("~")) {
    const home = process.env.HOME ?? "";
    return filePath.replace(/^~/, home);
  }
  return filePath;
}

function _isGlobalPath(filePath: string): boolean {
  return filePath.startsWith("~") || filePath.startsWith("/");
}

// ─── Front-matter stripping ──────────────────────────────────────────────────

export interface FrontMatterResult {
  frontMatter: Record<string, string>;
  body: string;
}

export function stripFrontMatter(text: string): FrontMatterResult {
  if (!text.startsWith("---")) return { frontMatter: {}, body: text };
  const end = text.indexOf("---", 3);
  if (end === -1) return { frontMatter: {}, body: text };
  const fmText = text.slice(3, end).trim();
  const body = text.slice(end + 3).trimStart();
  const fm: Record<string, string> = {};
  for (const line of fmText.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2];
  }
  return { frontMatter: fm, body };
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface Chunk {
  chunk_id: string;
  content: string;
  para_indices: number[];
  token_count: number;
  heading_level: number; // 0=none, 1=H1, 2=H2, 3=H3
  heading_text: string;   // heading content (empty if no heading)
}

export interface Section {
  level: number;      // 0 = unstated/root (content before any heading)
  title: string;      // heading text (empty string for level 0)
  body_lines: string[]; // paragraph strings belonging to this section
}

// ─── makeChunkId ─────────────────────────────────────────────────────────────

export function makeChunkId(filePath: string, chunkIndex: number): string {
  const home = process.env.HOME ?? "";
  if (_isGlobalPath(filePath)) {
    const display = filePath.startsWith(home)
      ? filePath.replace(home, "~")
      : filePath;
    return `global::${display}::${chunkIndex}`;
  } else {
    return `project::${filePath}::${chunkIndex}`;
  }
}

// ─── Token counting ──────────────────────────────────────────────────────────

/**
 * Simple word-based token estimate (no tiktoken needed in TS).
 */
export function countTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

// ─── Splitting ───────────────────────────────────────────────────────────────

const HEADING_RE = /^#{1,6}\s+(.+)$/;
const SENTENCE_END_RE = /[。？！；\n]/;

export function splitParagraphs(text: string): string[] {
  const paras: string[] = [];
  for (const para of text.split(/\n\n/)) {
    const stripped = para.trim();
    if (stripped) paras.push(stripped);
  }
  return paras;
}

export function splitSentences(text: string): string[] {
  const parts = text.split(SENTENCE_END_RE);
  return parts.map((p: string) => p.trim()).filter(Boolean);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _makeChunkObject(
  chunkParas: string[],
  filePath: string,
  chunkIndex: number,
  tokenCount: number,
  headingLevel: number,
  headingText: string,
): Chunk {
  return {
    chunk_id: makeChunkId(filePath, chunkIndex),
    content: chunkParas.join("\n\n"),
    para_indices: [],
    token_count: tokenCount,
    heading_level: headingLevel,
    heading_text: headingText,
  };
}

// ─── _make_chunks (paragraph-level chunking) ──────────────────────────────────

function _makeChunks(
  paragraphs: string[],
  filePath: string,
  maxTokens: number,
  overlapParas: number,
): Chunk[] {
  if (paragraphs.length === 0) return [];

  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let currentParas: string[] = [];
  let currentTokenCount = 0;
  let startParaIdx = 0;

  for (let paraIdx = 0; paraIdx < paragraphs.length; paraIdx++) {
    const para = paragraphs[paraIdx];
    const paraTokens = countTokens(para);

    // Handle super-long single paragraph
    if (paraTokens > maxTokens) {
      // Flush current chunk if non-empty
      if (currentParas.length > 0) {
        const chunkText = currentParas.join("\n\n");
        chunks.push({
          chunk_id: makeChunkId(filePath, chunkIndex),
          content: chunkText,
          para_indices: Array.from({ length: paraIdx - startParaIdx }, (_, i) => startParaIdx + i),
          token_count: currentTokenCount,
          heading_level: 0,
          heading_text: "",
        });
        chunkIndex++;
        currentParas = [];
        currentTokenCount = 0;
      }

      // Split the long paragraph by sentences
      const sentences = splitSentences(para);
      let subParas: string[] = [];
      let subTokenCount = 0;
      for (const sent of sentences) {
        const sentTokens = countTokens(sent);
        if (subTokenCount + sentTokens >= maxTokens && subParas.length > 0) {
          const subText = subParas.join("");
          chunks.push({
            chunk_id: makeChunkId(filePath, chunkIndex),
            content: subText,
            para_indices: [paraIdx],
            token_count: subTokenCount,
            heading_level: 0,
            heading_text: "",
          });
          chunkIndex++;
          subParas = [];
          subTokenCount = 0;
        }
        subParas.push(sent);
        subTokenCount += sentTokens;
      }
      if (subParas.length > 0) {
        currentParas = subParas;
        currentTokenCount = subTokenCount;
        startParaIdx = paraIdx;
      }
      continue;
    }

    // Normal paragraph — check if adding it exceeds max_tokens
    if (currentTokenCount + paraTokens > maxTokens && currentParas.length > 0) {
      const chunkText = currentParas.join("\n\n");
      chunks.push({
        chunk_id: makeChunkId(filePath, chunkIndex),
        content: chunkText,
        para_indices: Array.from({ length: paraIdx - startParaIdx }, (_, i) => startParaIdx + i),
        token_count: currentTokenCount,
        heading_level: 0,
        heading_text: "",
      });
      chunkIndex++;

      // Start new chunk with overlap paragraphs
      const overlapStart = Math.max(0, currentParas.length - overlapParas);
      currentParas = currentParas.slice(overlapStart);
      currentTokenCount = currentParas.reduce((sum, p) => sum + countTokens(p), 0);
      startParaIdx = paraIdx - currentParas.length + overlapStart;
    }

    currentParas.push(para);
    currentTokenCount += paraTokens;
  }

  // Flush remaining
  if (currentParas.length > 0) {
    const chunkText = currentParas.join("\n\n");
    chunks.push({
      chunk_id: makeChunkId(filePath, chunkIndex),
      content: chunkText,
      para_indices: Array.from({ length: paragraphs.length - startParaIdx }, (_, i) => startParaIdx + i),
      token_count: currentTokenCount,
      heading_level: 0,
      heading_text: "",
    });
  }

  return chunks;
}

// ─── _groupByHeadings ─────────────────────────────────────────────────────────

function _groupByHeadings(
  paragraphs: string[],
  headingLevels: number[],
): Section[] {
  const sections: Section[] = [];
  let current: Section = { level: 0, title: "", body_lines: [] };

  for (const para of paragraphs) {
    const trimmed = para.trim();
    const match = HEADING_RE.exec(trimmed);
    if (match) {
      const lvl = match[1].length;
      const headingTxt = match[2].trim();
      if (headingLevels.includes(lvl)) {
        // Save previous section if it has content
        if (current.body_lines.length > 0) {
          sections.push(current);
        }
        current = { level: lvl, title: headingTxt, body_lines: [] };
      } else {
        // Heading level not in scope — treat as body paragraph
        current.body_lines.push(para);
      }
    } else {
      current.body_lines.push(para);
    }
  }

  if (current.body_lines.length > 0) {
    sections.push(current);
  }

  return sections;
}

// ─── _splitBySentences ───────────────────────────────────────────────────────

function _splitBySentences(
  text: string,
  filePath: string,
  maxTokens: number,
  headingLevel: number,
  headingText: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  const sentences = text.split(SENTENCE_END_RE);
  let current: string[] = [];
  let currentTokens = 0;
  let subChunkIndex = 0;

  for (const sent of sentences) {
    const trimmed = sent.trim();
    if (!trimmed) continue;
    const sentTokens = countTokens(trimmed);

    if (currentTokens + sentTokens >= maxTokens && current.length > 0) {
      const chunkText = current.join("");
      chunks.push({
        chunk_id: makeChunkId(filePath, subChunkIndex),
        content: chunkText,
        para_indices: [],
        token_count: currentTokens,
        heading_level: headingLevel,
        heading_text: headingText,
      });
      subChunkIndex++;
      current = [];
      currentTokens = 0;
    }

    current.push(trimmed);
    currentTokens += sentTokens;
  }

  if (current.length > 0) {
    const chunkText = current.join("");
    chunks.push({
      chunk_id: makeChunkId(filePath, subChunkIndex),
      content: chunkText,
      para_indices: [],
      token_count: currentTokens,
      heading_level: headingLevel,
      heading_text: headingText,
    });
  }

  return chunks;
}

// ─── _sectionsToChunks ───────────────────────────────────────────────────────

function _sectionsToChunks(
  sections: Section[],
  filePath: string,
  maxTokens: number,
  overlapParas: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let overlapBuffer: string[] = [];
  let overlapTokens = 0;
  let overlapHeadingLevel = 0;
  let overlapHeadingText = "";

  for (const sec of sections) {
    const headingBlock = sec.title
      ? `${"#".repeat(sec.level)} ${sec.title}` + "\n\n"
      : "";
    const secText = sec.body_lines.join("\n\n");
    const secContent = headingBlock + secText;
    const secTokens = countTokens(secContent);

    if (secTokens > maxTokens) {
      // Flush overlap, split by sentences
      if (overlapBuffer.length > 0) {
        chunks.push(_makeChunkObject(
          overlapBuffer, filePath, chunkIndex,
          overlapTokens, overlapHeadingLevel, overlapHeadingText,
        ));
        chunkIndex++;
        overlapBuffer = [];
        overlapTokens = 0;
      }
      const subChunks = _splitBySentences(
        secText, filePath, maxTokens, sec.level, sec.title,
      );
      for (const sc of subChunks) {
        chunks.push({ ...sc, chunk_id: makeChunkId(filePath, chunkIndex) });
        chunkIndex++;
      }
      continue;
    }

    // Prepend overlap buffer to this section
    const chunkParas = [...overlapBuffer, secContent];
    const chunkTokens = overlapTokens + secTokens;

    if (chunkTokens > maxTokens && overlapBuffer.length > 0) {
      // Overlap too big — emit it separately
      chunks.push(_makeChunkObject(
        overlapBuffer, filePath, chunkIndex,
        overlapTokens, overlapHeadingLevel, overlapHeadingText,
      ));
      chunkIndex++;
    }

    // Emit this section as a chunk
    chunks.push(_makeChunkObject(
      chunkParas, filePath, chunkIndex, chunkTokens, sec.level, sec.title,
    ));
    chunkIndex++;

    // Update overlap buffer
    if (overlapParas > 0 && sec.body_lines.length > 0) {
      const keepParas = sec.body_lines.slice(-overlapParas);
      const keepContent = keepParas.join("\n\n");
      overlapBuffer = [keepContent];
      overlapTokens = countTokens(keepContent);
      overlapHeadingLevel = sec.level;
      overlapHeadingText = sec.title;
    } else {
      overlapBuffer = [];
      overlapTokens = 0;
    }
  }

  return chunks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunk raw content text (no front-matter stripping).
 */
export function chunkContent(
  content: string,
  filePath: string,
  maxTokens: number,
  overlapParas: number,
): Chunk[] {
  const paragraphs = splitParagraphs(content);
  return chunkByHeadings(paragraphs, filePath, maxTokens, overlapParas);
}

/**
 * Chunk a file: read it, strip front-matter, chunk content.
 */
export function chunkFile(
  filePath: string,
  maxTokens: number,
  overlapParas: number,
): Chunk[] {
  const text = readFileSync(filePath, "utf-8");
  const { body } = stripFrontMatter(text);
  const paragraphs = splitParagraphs(body);
  return chunkByHeadings(paragraphs, filePath, maxTokens, overlapParas);
}

/**
 * Split markdown content by H1/H2/H3 headings as semantic units.
 */
export function chunkByHeadings(
  paragraphs: string[],
  filePath: string,
  maxTokens: number,
  overlapParas: number,
  headingLevels: number[] = [1, 2, 3],
): Chunk[] {
  if (paragraphs.length === 0) return [];

  const sections = _groupByHeadings(paragraphs, headingLevels);
  if (sections.length === 0) {
    return _makeChunks(paragraphs, filePath, maxTokens, overlapParas);
  }

  return _sectionsToChunks(sections, filePath, maxTokens, overlapParas);
}

/**
 * Simple paragraph-count-based chunking (alternative to token-based).
 */
export function chunkParagraphsSimple(
  paragraphs: string[],
  filePath: string,
  chunkSizeParas: number = 1,
  overlapParas: number = 0,
): Chunk[] {
  const chunks: Chunk[] = [];
  if (paragraphs.length === 0) return [];

  // Guard: overlap must be less than chunk size
  const effectiveOverlap = overlapParas >= chunkSizeParas ? 0 : overlapParas;
  const step = Math.max(1, chunkSizeParas - effectiveOverlap);

  let start = 0;
  let chunkIndex = 0;
  while (start < paragraphs.length) {
    const end = Math.min(start + chunkSizeParas, paragraphs.length);
    const chunkParas = paragraphs.slice(start, end);
    const chunkText = chunkParas.join("\n\n");
    chunks.push({
      chunk_id: makeChunkId(filePath, chunkIndex),
      content: chunkText,
      para_indices: Array.from({ length: end - start }, (_, i) => start + i),
      token_count: countTokens(chunkText),
      heading_level: 0,
      heading_text: "",
    });
    chunkIndex++;
    start += step;
    if (start >= paragraphs.length) break;
  }

  return chunks;
}
