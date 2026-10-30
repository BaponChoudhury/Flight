import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Cookie policy · Fly To Roots" };

const OURS: [string, string, string, string][] = [
  ["fl_session", "Cookie", "Keeps you signed in to the members' tools after you use an email link.", "30 days, or until you sign out"],
  ["ground:<your town>", "Your browser's local storage", "Remembers the train, coach or cab fares you typed for getting to each airport, so you don't retype them.", "Until you clear your browser data"],
  ["compensair-consent", "Your browser's local storage", "Remembers that you chose to load Compensair's claim form.", "Until you clear your browser data"],
];

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie policy" intro="The cookies and similar storage we use. The essential ones keep the site working; Google Analytics is optional and only runs if you accept it.">
      <h2>Essential (always on)</h2>
      <p>
        Under UK law (the Privacy and Electronic Communications Regulations), sites need your consent for cookies except those that are strictly necessary
        for a service you ask for. These are in that category.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>What it does</th><th>How long</th></tr>
          </thead>
          <tbody>
            {OURS.map(([name, type, what, long]) => (
              <tr key={name}><td className="font-mono text-xs">{name}</td><td>{type}</td><td>{what}</td><td>{long}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Analytics (only if you accept)</h2>
      <p>
        We use Google Analytics to count visits and see which pages and features people use, so we can improve the site. Its cookies are only set after
        you click Accept on our cookie banner. Until then, or if you reject, it sets no cookies and stores nothing on your device; Google receives only
        basic, cookieless signals (such as that a page was viewed) to estimate overall numbers. Google may process this data in the US.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Name</th><th>Set by</th><th>What it does</th><th>How long</th></tr>
          </thead>
          <tbody>
            <tr><td className="font-mono text-xs">_ga</td><td>Google Analytics</td><td>Tells visits from the same browser apart.</td><td>2 years</td></tr>
            <tr><td className="font-mono text-xs">_ga_96PSQ9Q9EK</td><td>Google Analytics</td><td>Keeps track of your current visit.</td><td>2 years</td></tr>
            <tr><td className="font-mono text-xs">cookie-consent</td><td>Us (local storage)</td><td>Remembers whether you accepted or rejected analytics.</td><td>Until you clear your browser data</td></tr>
          </tbody>
        </table>
      </div>
      <p>You can change your mind at any time with <strong>Cookie settings</strong> at the bottom of every page.</p>

      <h2>Third-party cookies</h2>
      <ul>
        <li>
          <strong>Compensair:</strong> the claim form on our <Link href="/claim">claim page</Link> comes from Compensair&apos;s website and may set its own
          cookies. We only load it after you click to show it.
        </li>
        <li>
          <strong>Airlines and travel agents:</strong> when you click through to book, the seller&apos;s website (and the booking partner that tracks the referral)
          sets its own cookies under its own policy.
        </li>
      </ul>

      <h2>Managing cookies</h2>
      <p>
        You can delete or block cookies in your browser settings. If you block the sign-in cookie, the members&apos; tools won&apos;t work; the rest of the
        site will. If we add any other optional cookies, we&apos;ll ask for your consent first and update this page.
      </p>

      <h2>More about your data</h2>
      <p>See our <Link href="/privacy">privacy notice</Link>.</p>
    </LegalPage>
  );
}
