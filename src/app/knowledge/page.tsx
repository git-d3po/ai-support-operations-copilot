import type { Metadata } from "next";
import { db } from "@/lib/db";
import { parseKnowledgeText, type Inline, type KnowledgeBlock } from "@/lib/knowledgeText";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TableScroll } from "@/components/ui/TableScroll";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Knowledge & Policies" };

export default async function KnowledgePage() {
  const [policies, docs] = await Promise.all([
    db.policy.findMany({ orderBy: { category: "asc" } }),
    db.productDoc.findMany({ orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-lg font-semibold">Knowledge &amp; Policies</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The company policies and product documentation used in ticket analysis. The Policy Agent and the Risk /
        Escalation Agent cite policies, and a policy cited on a ticket links to its entry here. The Technical
        Support Agent consults the product documentation relevant to a ticket; documentation is not cited on
        tickets.
      </p>

      {/* Policies, then product documentation: side by side from tablet width, one after the other on a phone. */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section aria-labelledby="policies-heading">
          <SectionHeading id="policies-heading">Policies</SectionHeading>
          <ul className="mt-2 flex flex-col gap-3">
            {policies.map((policy) => (
              // `policy-<slug>` is the anchor the ticket page's policy citations link to; Next scrolls it
              // into view. (No `:target` highlight: Next's client-side navigation uses pushState, which
              // does not update `:target`, so it would only ever show on a full page load.)
              <li key={policy.id} id={`policy-${policy.slug}`} className="scroll-mt-6">
                <KnowledgeEntry
                  title={policy.title}
                  version={policy.version}
                  meta={`${policy.category} · ${policy.slug}`}
                  body={policy.body}
                />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="docs-heading">
          <SectionHeading id="docs-heading">Product documentation</SectionHeading>
          <ul className="mt-2 flex flex-col gap-3">
            {docs.map((doc) => (
              <li key={doc.id}>
                <KnowledgeEntry title={doc.title} version={doc.version} meta={`${doc.product} · ${doc.slug}`} body={doc.body} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** One policy or document: its name and version, then its full text, as stored. */
function KnowledgeEntry({ title, version, meta, body }: { title: string; version: string; meta: string; body: string }) {
  return (
    <Card padding="md" className="text-sm">
      <div className="flex justify-between gap-4">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">v{version}</span>
      </div>
      <p className="text-xs text-muted-foreground">{meta}</p>
      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
        {parseKnowledgeText(body, title).map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </Card>
  );
}

function Block({ block }: { block: KnowledgeBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <h4 className="font-medium text-foreground">
          <InlineText parts={block.text} />
        </h4>
      );
    case "paragraph":
      return (
        <p>
          <InlineText parts={block.text} />
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineText parts={item} />
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        // A table in a policy or document scrolls inside the entry rather than widening a narrow column.
        <TableScroll>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {block.header.map((cell, i) => (
                  <th key={i} className="py-1 pr-4 font-medium">
                    <InlineText parts={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-900">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1 pr-4">
                      <InlineText parts={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      );
  }
}

function InlineText({ parts }: { parts: Inline[] }) {
  return parts.map((part, i) =>
    part.kind === "strong" ? (
      <strong key={i} className="font-medium text-foreground">
        {part.text}
      </strong>
    ) : part.kind === "code" ? (
      <code key={i} className="font-mono text-xs">
        {part.text}
      </code>
    ) : (
      part.text
    ),
  );
}
