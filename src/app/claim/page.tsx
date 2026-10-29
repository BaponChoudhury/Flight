import { CompensairFrame } from "@/components/CompensairFrame";
import { COMPENSAIR_PARTNER, compensairFrameSrc } from "@/lib/followups";

export const metadata = { title: "Claim flight compensation · Flights to India" };

const RULES: [string, string][] = [
  ["Leaving the UK or EU", "Any airline. For example London → Delhi on Air India or Emirates."],
  ["Arriving in the UK or EU", "Only on a UK or EU airline. Delhi → London on Air India or IndiGo usually doesn't qualify."],
  ["Domestic flights in India", "Not covered by UK or EU rules."],
  ["Separate tickets", "A missed connection on a second, separate ticket isn't covered."],
];

// Compensair's partner iframe. Its name is our partner ID, which credits claims to us. A claim
// form of our own that posts through their API (ClaimForm, /api/claims) is parked until their
// new API version is out.
export default async function ClaimPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const src = compensairFrameSrc(await searchParams);
  return (
    <>
      <div className="relative bg-brand-950 px-4 pb-24 pt-8 text-white sm:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_25rem_at_80%_-10%,rgba(59,102,245,0.45),transparent)]" />
        <div className="relative mx-auto max-w-5xl">
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Flight delayed or cancelled? Claim up to £520.</h1>
          <p className="mt-2 max-w-2xl text-base text-white/75 sm:text-lg">
            Under UK and EU rules you may be owed compensation for a delay of 3 hours or more, a cancellation, or being denied boarding. Our partner
            Compensair checks your flight and handles the claim for you; their terms and fees apply.
          </p>
        </div>
      </div>
      <div className="relative -mt-20 mx-auto grid max-w-5xl gap-5 px-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-800">
          <CompensairFrame src={src} name={COMPENSAIR_PARTNER} />
        </div>
        <aside className="rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="font-bold">Which flights qualify?</h2>
          <ul className="mt-3 space-y-3">
            {RULES.map(([title, text]) => (
              <li key={title}>
                <p className="font-semibold">{title}</p>
                <p className="text-slate-600 dark:text-slate-400">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Claims can usually be made for flights in the last 6 years (UK). Compensair checks every claim and tells you if yours qualifies.
          </p>
        </aside>
      </div>
    </>
  );
}
