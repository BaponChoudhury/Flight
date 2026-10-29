import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flights to India",
  description: "Cheapest and fastest door-to-door routes from the UK to smaller Indian cities, including split tickets.",
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Display serif for headlines only.
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"], display: "swap" });

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1c2f78" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="bg-brand-950 text-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 shadow-inner">
                <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-45" fill="currentColor" aria-hidden="true">
                  <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
                </svg>
              </span>
              <span className="whitespace-nowrap text-lg font-bold tracking-tight">Flights to India</span>
            </Link>
            <div className="flex items-center gap-1">
              <Link href="/refund-calculator" className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
                <span className="sm:hidden">Refunds</span>
                <span className="hidden sm:inline">Refund calculator</span>
              </Link>
              <Link href="/claim" className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
                <span className="sm:hidden">Claim</span>
                <span className="hidden sm:inline">Claim compensation</span>
              </Link>
              <Link href="/admin" className="hidden rounded-lg px-3 py-1.5 sm:inline text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
                Admin
              </Link>
            </div>
          </nav>
        </header>
        <main className="pb-16">{children}</main>
        <footer className="border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-800">
          <nav aria-label="Legal" className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/cookies" className="hover:underline">Cookies</Link>
          </nav>
          <p>Prices come from airline and travel-agent sites and can change. Always check the final price before you book.</p>
          <p className="mt-1">We may earn a commission when you book through our links. It doesn&apos;t change your price.</p>
        </footer>
      </body>
    </html>
  );
}
