import { describe, expect, it } from "vitest";
import { POLICIES } from "../../prisma/data/policies";
import { PRODUCT_DOCS } from "../../prisma/data/productDocs";
import { parseInline, parseKnowledgeText, type Inline, type KnowledgeBlock } from "@/lib/knowledgeText";

/**
 * The Knowledge page's reader for policy and product-doc bodies
 * (src/lib/knowledgeText.ts). Checked against the real seeded bodies, since
 * those are what a policy citation lands on: every word of a body must reach the
 * page, and no Markdown syntax may be left showing.
 */
const inlineText = (parts: Inline[]) => parts.map((p) => p.text).join("");
const blockText = (block: KnowledgeBlock): string => {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return inlineText(block.text);
    case "list":
      return block.items.map(inlineText).join(" ");
    case "table":
      return [block.header, ...block.rows].map((row) => row.map(inlineText).join(" ")).join(" ");
  }
};
const words = (text: string) =>
  text
    .replace(/[*`]/g, "")
    .replace(/[#|]|^\s*-\s|^\s*\d+\.\s/gm, " ")
    .split(/\s+/)
    .filter((w) => w && !/^-+$/.test(w));

describe("parseInline", () => {
  it("reads **bold** and `code` spans and keeps the rest as text", () => {
    expect(parseInline("Mark it `requires_review`, **not** denied.")).toEqual([
      { kind: "text", text: "Mark it " },
      { kind: "code", text: "requires_review" },
      { kind: "text", text: ", " },
      { kind: "strong", text: "not" },
      { kind: "text", text: " denied." },
    ]);
  });
});

describe("parseKnowledgeText", () => {
  it("drops the leading heading that repeats the entry's title, and joins hard-wrapped lines", () => {
    const blocks = parseKnowledgeText("# Refund Policy\n\nFirst line\nwraps here.\n", "Refund Policy");
    expect(blocks).toEqual([{ kind: "paragraph", text: [{ kind: "text", text: "First line wraps here." }] }]);
  });

  it("reads numbered and bulleted lists, including indented continuation lines", () => {
    const blocks = parseKnowledgeText("1. **One**, first\n   continued.\n2. Two.\n\n- A\n  more\n- B");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: true,
        items: [
          [
            { kind: "strong", text: "One" },
            { kind: "text", text: ", first continued." },
          ],
          [{ kind: "text", text: "Two." }],
        ],
      },
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "A more" }], [{ kind: "text", text: "B" }]] },
    ]);
  });

  it("reads a pipe table, without its separator rule", () => {
    const [table] = parseKnowledgeText("| Plan | First response |\n|------|------|\n| Starter | 24 business hours |");
    expect(table).toEqual({
      kind: "table",
      header: [[{ kind: "text", text: "Plan" }], [{ kind: "text", text: "First response" }]],
      rows: [[[{ kind: "text", text: "Starter" }], [{ kind: "text", text: "24 business hours" }]]],
    });
  });

  it("reads an indented list as items too, and always consumes its lines", () => {
    expect(parseKnowledgeText("  - indented\n  - again")).toEqual([
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "indented" }], [{ kind: "text", text: "again" }]] },
    ]);
  });

  it.each([...POLICIES, ...PRODUCT_DOCS].map((entry) => [entry.slug, entry] as const))(
    "%s: every word of the seeded body reaches the page, with no Markdown syntax left in the text",
    (_slug, entry) => {
      const blocks = parseKnowledgeText(entry.body, entry.title);
      const rendered = blocks.map(blockText).join(" ");

      expect(blocks.length).toBeGreaterThan(0);
      expect(rendered).not.toMatch(/\*\*|`|^#|\|/m);
      // The body's words, minus the title heading the page already shows, in order.
      const expected = words(entry.body.replace(/^#\s+.*\n/, ""));
      expect(words(rendered)).toEqual(expected);
    },
  );
});
