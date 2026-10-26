export const metadata = { title: "Unsubscribe · Flights to India" };

const box = "rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800";

// A plain form (no JavaScript needed) rather than unsubscribing on page load, so email link
// scanners can't unsubscribe people by fetching the link.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string; error?: string }> }) {
  const { token = "", done, error } = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className={box}>
        <h1 className="text-xl font-bold">Stop compensation emails</h1>
        {done ? (
          <p className="mt-2 text-slate-600 dark:text-slate-400">Done. We won&apos;t email you about this trip, and we&apos;ve deleted your email address from it.</p>
        ) : (
          <>
            <p className="mt-2 text-slate-600 dark:text-slate-400">We&apos;ll stop the compensation check email for this trip and delete your email address from it.</p>
            <form method="post" action={`/api/followups/unsubscribe?token=${encodeURIComponent(token)}`}>
              <button type="submit" disabled={!token} className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                Unsubscribe
              </button>
            </form>
            {!token && <p className="mt-3 text-sm text-rose-700">This link is incomplete.</p>}
            {error && <p className="mt-3 text-sm text-rose-700">This link has expired or was already used.</p>}
          </>
        )}
      </div>
    </div>
  );
}
