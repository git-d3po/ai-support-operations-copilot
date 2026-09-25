import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { Nav } from "@/components/nav";
import { geistMono, geistSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  // Each page names itself ("Inbox · AI Support Operations Copilot"), so tabs and history are distinguishable.
  // Pages, the ticket's generateMetadata and app/not-found.tsx set only their own name.
  title: { template: "%s · AI Support Operations Copilot", default: "AI Support Operations Copilot" },
  description: "Internal support operations copilot for the fictional Halcyon SaaS platform.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Background and text color come from globals.css (the token source of truth); this only sets layout.
          From `lg`: the sidebar beside a page that scrolls on its own. Below `lg`: the navigation bar above
          the page and the document scrolls as a whole, so the bar scrolls away instead of holding space. */}
      <body className="min-h-screen lg:flex lg:h-full">
        <Nav />
        <main className="min-w-0 lg:flex-1 lg:overflow-y-auto">
          <ModeBanner />
          {children}
        </main>
      </body>
    </html>
  );
}
