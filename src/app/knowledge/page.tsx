import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [policies, docs] = await Promise.all([
    db.policy.findMany({ orderBy: { category: "asc" } }),
    db.productDoc.findMany({ orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Knowledge &amp; Policies</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The exact policy and product documentation specialist agents ground
        their findings in — nothing here is invisible to the operator.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <section>
          <h2 className="text-sm font-semibold">Policies</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {policies.map((policy) => (
              <li key={policy.id} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex justify-between">
                  <span className="font-medium">{policy.title}</span>
                  <span className="text-xs text-zinc-500">v{policy.version}</span>
                </div>
                <p className="text-xs text-zinc-500">{policy.category} · {policy.slug}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Product documentation</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {docs.map((doc) => (
              <li key={doc.id} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex justify-between">
                  <span className="font-medium">{doc.title}</span>
                  <span className="text-xs text-zinc-500">v{doc.version}</span>
                </div>
                <p className="text-xs text-zinc-500">{doc.product} · {doc.slug}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
