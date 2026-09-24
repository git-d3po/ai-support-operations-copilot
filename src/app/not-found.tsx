import type { Metadata } from "next";
import Link from "next/link";
import { AppState, PRIMARY_ACTION_CLASSES } from "@/components/app-state";

export const metadata: Metadata = {
  title: "Page not found · AI Support Operations Copilot",
};

/**
 * The application's not-found state. As the root `not-found.tsx` it handles both
 * URLs that match no route and every `notFound()` call, such as the ticket page's
 * for an unknown ticket id (a ticket link can go out of date: the demo database
 * is rebuilt, with new ids, whenever the deployment restarts). It renders inside
 * the root layout, so the navigation stays available. A missing page is not a
 * failure, so it says nothing about errors and offers no retry; see
 * app/error.tsx for failures. DECISIONS.md: "Application not-found and error
 * states".
 */
export default function NotFound() {
  return (
    <AppState
      title="Page not found"
      actions={
        <Link href="/inbox" className={PRIMARY_ACTION_CLASSES}>
          Go to the Inbox
        </Link>
      }
    >
      <p>There&apos;s nothing at this address. The link may be mistyped or out of date.</p>
    </AppState>
  );
}
