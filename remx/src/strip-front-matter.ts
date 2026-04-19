/**
 * Strip YAML front-matter from markdown text.
 * Simple implementation — no external dependencies.
 */
export function stripFrontMatter(text: string): { frontMatter: Record<string, any>; body: string } {
  if (!text.startsWith("---")) return { frontMatter: {}, body: text };
  const end = text.indexOf("---", 3);
  if (end === -1) return { frontMatter: {}, body: text };
  const fmText = text.slice(3, end).trim();
  const body = text.slice(end + 3).trimStart();
  // Simple YAML key: value parsing (no external deps needed for this)
  const fm: Record<string, any> = {};
  for (const line of fmText.split("\n")) {
    const m = line.match(/^(\w+(?:_\w+)?):\s*(.*)$/);
    if (m) {
      let val: any = m[2];
      if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (!isNaN(Number(val))) val = Number(val);
      fm[m[1]] = val;
    }
  }
  return { frontMatter: fm, body };
}
