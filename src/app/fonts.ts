import { Geist, Geist_Mono } from "next/font/google";

/**
 * The app's fonts, defined once. Imported by the root layout and by
 * app/global-error.tsx, which replaces the root layout when it renders and so
 * must load the fonts itself.
 */
export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
