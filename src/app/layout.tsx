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
      {/* Background and text color come from globals.css (the token source of truth); this only sets layout. */}
      <body className="flex h-full min-h-screen">
        <Nav />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <ModeBanner />
          {children}
        </main>
      </body>
    </html>
  );
}
