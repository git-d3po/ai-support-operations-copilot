import { Card } from "./Card";
import { Eyebrow } from "./SectionHeading";

/**
 * A labeled metric tile — was a local function in `operations/page.tsx` only; generalized so any page can use it.
 * The label is a plain `<p>` styled as an eyebrow, not a heading: a tile names a value, it doesn't open a
 * section, and seven tile headings used to crowd the page's outline.
 */
export function Stat({ label, value, className = "" }: { label: string; value: string | number; className?: string }) {
  return (
    <Card padding="lg" className={className}>
      <Eyebrow as="p">{label}</Eyebrow>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}
