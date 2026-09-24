import { db } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [policies, docs] = await Promise.all([
    db.policy.findMany({ orderBy: { category: "asc" } }),
    db.productDoc.findMany({ orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Knowledge &amp; Policies</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The exact policy and product documentation specialist agents ground
        their findings in — nothing here is invisible to the operator.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <section>
          <SectionHeading>Policies</SectionHeading>
          <ul className="mt-2 flex flex-col gap-3">
            {policies.map((policy) => (
              // `policy-<slug>` is the anchor the ticket page's policy citations link to; Next scrolls it
              // into view. (No `:target` highlight: Next's client-side navigation uses pushState, which
              // does not update `:target`, so it would only ever show on a full page load.)
              <li key={policy.id} id={`policy-${policy.slug}`} className="scroll-mt-6">
                <Card padding="md" className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{policy.title}</span>
                    <span className="text-xs text-muted-foreground">v{policy.version}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{policy.category} · {policy.slug}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHeading>Product documentation</SectionHeading>
          <ul className="mt-2 flex flex-col gap-3">
            {docs.map((doc) => (
              <li key={doc.id}>
                <Card padding="md" className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{doc.title}</span>
                    <span className="text-xs text-muted-foreground">v{doc.version}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{doc.product} · {doc.slug}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
