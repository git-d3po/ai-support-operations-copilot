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
      className="border-b border-purple-200 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300"
    >
      Demo Mode — synthetic data, scripted replay, no model is called
    </div>
  );
}
