/**
 * Reads the Markdown bodies of the Knowledge base (`Policy.body`, `ProductDoc.body`)
 * into a small block structure the Knowledge page renders, so a cited policy
 * shows its actual text rather than raw Markdown syntax.
 *
 * Deliberately not a Markdown implementation: it covers exactly the constructs
 * the seeded bodies use (prisma/data/policies.ts, productDocs.ts): headings,
 * paragraphs with hard-wrapped lines, bulleted and numbered lists with indented
 * continuation lines, one pipe table, **bold** and `code`. Anything else is
 * kept as plain paragraph text, never dropped. No HTML is produced or trusted:
 * the page renders these blocks as React elements, so the text stays text.
 */

export type Inline = { kind: "text" | "strong" | "code"; text: string };

export type KnowledgeBlock =
  | { kind: "heading"; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

const BULLET = /^[-*]\s+/;
const NUMBERED = /^\d+\.\s+/;
const HEADING = /^#{1,6}\s+/;

/** `**bold**` and `` `code` `` spans; everything else is text. */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push(match[1] !== undefined ? { kind: "strong", text: match[1] } : { kind: "code", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));

/**
 * Splits a body into blocks. The body's leading `# Title` is dropped when it
 * repeats `title`, which the page already shows as the entry's name.
 */
export function parseKnowledgeText(body: string, title?: string): KnowledgeBlock[] {
  const blocks: KnowledgeBlock[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (HEADING.test(trimmed)) {
      const text = trimmed.replace(HEADING, "");
      if (!(blocks.length === 0 && title !== undefined && text === title)) {
        blocks.push({ kind: "heading", text: parseInline(text) });
      }
      i++;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) tableLines.push(lines[i++]);
      const [headerLine, ...rest] = tableLines;
      const bodyLines = rest.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row.trim())); // drop the |---| rule
      blocks.push({ kind: "table", header: tableCells(headerLine), rows: bodyLines.map(tableCells) });
      continue;
    }

    if (BULLET.test(trimmed) || NUMBERED.test(trimmed)) {
      const ordered = NUMBERED.test(trimmed);
      const marker = ordered ? NUMBERED : BULLET;
      const indentOf = (text: string) => text.length - text.trimStart().length;
      const listIndent = indentOf(line);
      const items: string[] = [trimmed.replace(marker, "")];
      i++;
      while (i < lines.length) {
        const current = lines[i];
        const currentTrimmed = current.trim();
        if (currentTrimmed === "") break;
        if (marker.test(currentTrimmed) && indentOf(current) <= listIndent) {
          items.push(currentTrimmed.replace(marker, "")); // the next item
        } else if (indentOf(current) > listIndent) {
          items[items.length - 1] += ` ${currentTrimmed}`; // an indented continuation of the item above
        } else {
          break;
        }
        i++;
      }
      blocks.push({ kind: "list", ordered, items: items.map(parseInline) });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i].trim();
      if (current === "" || HEADING.test(current) || current.startsWith("|")) break;
      if (paragraph.length > 0 && (BULLET.test(current) || NUMBERED.test(current))) break;
      paragraph.push(current);
      i++;
    }
    blocks.push({ kind: "paragraph", text: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}
