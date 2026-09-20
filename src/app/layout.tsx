import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ModeBanner } from "@/components/mode-banner";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Support Operations Copilot",
  description: "Internal support operations copilot for the fictional Halcyon SaaS platform.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full min-h-screen bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
        <Nav />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <ModeBanner />
          {children}
        </main>
      </body>
    </html>
  );
}
