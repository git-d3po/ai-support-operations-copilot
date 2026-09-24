import { getAiMode } from "@/lib/ai/mode";

/**
 * Site-wide indicator, shown only in Demo Mode (`AI_MODE=demo`). Says plainly
 * what a visitor is looking at, so scripted output can never be mistaken for a
 * live model. Read on the server per request, never from the client.
 */
export function ModeBanner() {
  if (getAiMode() !== "demo") return null;
  return (
    <div
      role="status"
      className="border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
    >
      Demo Mode — synthetic data, scripted replay, no model is called
    </div>
  );
}
