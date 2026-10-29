import { LEGAL } from "@/lib/config/legal";

/** Shared layout for the Terms, Privacy and Cookies pages. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <>
      <div className="bg-brand-950 px-4 pb-16 pt-10 text-white sm:pt-14">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-3 text-white/75">{intro}</p>
          <p className="mt-2 text-sm text-white/50">Last updated {LEGAL.lastUpdated}</p>
        </div>
      </div>
      <article className="mx-auto -mt-8 max-w-3xl rounded-2xl bg-white px-5 py-8 shadow-sm ring-1 ring-slate-200/80 sm:px-10 dark:bg-slate-900 dark:ring-slate-800 [&_a]:font-medium [&_a]:text-brand-600 [&_a]:underline dark:[&_a]:text-brand-300 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2:first-child]:mt-0 [&_li]:mt-1 [&_p]:mt-3 [&_p]:leading-relaxed [&_table]:mt-3 [&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:border-slate-200 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top dark:[&_td]:border-slate-700 [&_th]:py-2 [&_th]:pr-3 [&_th]:text-left [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 text-slate-700 dark:text-slate-300">
        {children}
      </article>
    </>
  );
}
