"use client"; // Next.js error boundaries must be Client Components.

import { useEffect, useRef } from "react";
import { AppState, PRIMARY_ACTION_CLASSES } from "@/components/app-state";
import { geistMono, geistSans } from "./fonts";
import "./globals.css";

/**
 * The error state for a failure in the root layout itself, which app/error.tsx
 * cannot catch (it sits inside the layout). A real case: the layout's Demo Mode
 * banner reads `AI_MODE`, and an invalid value (e.g. `AI_MODE=Demo`) throws by
 * design (src/lib/ai/mode.ts). Without this file Next shows its built-in page.
 *
 * It replaces the root layout while active, so it renders its own document,
 * styles and fonts, and there is no navigation to keep: the layout that renders
 * it is what failed. For the same reason it offers only "Try again" (`retry()`,
 * which re-fetches and re-renders): any link would render the same layout.
 * As in app/error.tsx, the error's message is never shown.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // For the operator's console; never shown in the UI.
    console.error(error);
  }, [error]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full min-h-screen">
        <title>Something went wrong · AI Support Operations Copilot</title>
        <main className="min-w-0 flex-1">
          <AppState
            title="Something went wrong"
            headingRef={headingRef}
            actions={
              <button type="button" onClick={() => retry()} className={PRIMARY_ACTION_CLASSES}>
                Try again
              </button>
            }
          >
            <p>The application couldn&apos;t be loaded.</p>
            {error.digest && <p className="mt-2 font-mono text-xs">Error reference: {error.digest}</p>}
          </AppState>
        </main>
      </body>
    </html>
  );
}
