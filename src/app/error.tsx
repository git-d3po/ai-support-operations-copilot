"use client"; // Next.js error boundaries must be Client Components.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AppState, PRIMARY_ACTION_CLASSES, SECONDARY_ACTION_CLASSES } from "@/components/app-state";

/**
 * The application's runtime-error state: the root segment's error boundary.
 *
 * Placement: `app/error.tsx` wraps every page below the root layout but not the
 * layout itself, so when a page fails (for example, a database read), the
 * navigation and the Demo Mode banner stay on screen and only the page area is
 * replaced. A failure in the root layout itself is handled by
 * app/global-error.tsx. `notFound()` never reaches this boundary: Next re-throws
 * its router signals past error boundaries to the not-found state.
 *
 * Recovery: `retry()` refreshes the route's server data and then re-renders the
 * segment, which is what recovers a transient server-side failure. (`reset()`
 * would only re-render without re-fetching, repeating a failed server render.)
 * The boundary also clears itself on navigation, so the nav and the Inbox link
 * are recovery paths too. The Inbox link is left out when the failing page is
 * the Inbox itself, where it could only lead back to the same failure.
 *
 * What the user sees is deliberately generic. The error's message is never
 * rendered: it can carry internal details (paths, queries, configuration), and
 * this UI cannot know the cause. Only `digest`, the opaque id Next attaches to
 * server errors to match server logs, is shown, as a reference.
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const offerInbox = usePathname() !== "/inbox";

  useEffect(() => {
    // For the operator's console; never shown in the UI.
    console.error(error);
  }, [error]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <AppState
      title="Something went wrong"
      headingRef={headingRef}
      actions={
        <>
          <button type="button" onClick={() => retry()} className={PRIMARY_ACTION_CLASSES}>
            Try again
          </button>
          {offerInbox && (
            <Link href="/inbox" className={SECONDARY_ACTION_CLASSES}>
              Go to the Inbox
            </Link>
          )}
        </>
      }
    >
      <p>This page couldn&apos;t be loaded. {offerInbox ? "Try again, or go to the Inbox." : "Try again."}</p>
      {error.digest && <p className="mt-2 font-mono text-xs">Error reference: {error.digest}</p>}
    </AppState>
  );
}
