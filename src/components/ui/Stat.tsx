import { Card } from "./Card";
import { Eyebrow } from "./SectionHeading";

/** A labeled metric tile — was a local function in `operations/page.tsx` only; generalized so any page can use it. */
export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card padding="lg">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}
