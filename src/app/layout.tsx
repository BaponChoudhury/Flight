import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flights to India",
  description: "Cheapest and fastest door-to-door routes from the UK to smaller Indian cities, including split tickets.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1c2f78" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="bg-brand-950 text-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 shadow-inner">
                <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-45" fill="currentColor" aria-hidden="true">
                  <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
                </svg>
              </span>
              <span className="text-lg font-bold tracking-tight">Flights to India</span>
            </Link>
            <div className="flex items-center gap-1">
              <Link href="/claim" className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
                Claim compensation
              </Link>
              <Link href="/admin" className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
                Admin
              </Link>
            </div>
          </nav>
        </header>
        <main className="pb-16">{children}</main>
        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800">
          Prices come from airline and travel-agent sites and can change. Always check the final price before you book.
        </footer>
      </body>
    </html>
  );
}
