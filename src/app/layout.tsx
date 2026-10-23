import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flights to India",
  description: "Cheapest and fastest door-to-door routes from the UK to smaller Indian cities, including split tickets.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <nav className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold">Flights to India</Link>
            <Link href="/admin" className="text-sm text-sky-700 underline dark:text-sky-400">Admin</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
