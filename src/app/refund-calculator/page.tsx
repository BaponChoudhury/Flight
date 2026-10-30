import { cookies } from "next/headers";
import { RefundCalculator } from "@/components/RefundCalculator";
import { SignIn } from "@/components/SignIn";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const metadata = { title: "Flight refund calculator · Fly To Roots" };

// Members only: the calculator sits behind an email-link sign-in.
export default async function RefundCalculatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const initial = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 40) : undefined]));
  const session = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  const query = new URLSearchParams(Object.entries(initial).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <>
      <div className="relative overflow-hidden bg-brand-950 px-4 pb-24 pt-10 text-white sm:pt-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55rem_28rem_at_85%_-10%,rgba(59,102,245,0.5),transparent)]" />
        <div className="relative mx-auto max-w-6xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-300">Members&apos; tool</p>
          <h1 className="mt-2 max-w-3xl font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">How much can you get back?</h1>
          <p className="mt-3 max-w-2xl text-white/75">
            Cancelling, missed your flight, or the airline cancelled? See what you&apos;re owed: refunds, unused taxes like Air Passenger Duty (even on non-refundable tickets), agent fees and compensation, with an email ready to send.
          </p>
          {session && (
            <form action="/api/auth/logout" method="post" className="mt-4 text-sm text-white/70">
              Signed in as {session.email} ·{" "}
              <button type="submit" className="underline hover:text-white">Sign out</button>
            </form>
          )}
        </div>
      </div>
      <div className="relative mx-auto -mt-16 max-w-6xl px-4">
        {session ? (
          <RefundCalculator initial={initial} email={session.email} />
        ) : (
          <SignIn next={`/refund-calculator${query ? `?${query}` : ""}`} title="Sign in to use the calculator" intro="It's free. Enter your email and we'll send you a one-tap sign-in link." />
        )}
      </div>
    </>
  );
}
