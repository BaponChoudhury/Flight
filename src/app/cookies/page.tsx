import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Cookie policy · Flights to India" };

const OURS: [string, string, string, string][] = [
  ["fl_session", "Cookie", "Keeps you signed in to the members' tools after you use an email link.", "30 days, or until you sign out"],
  ["ground:<your town>", "Your browser's local storage", "Remembers the train, coach or cab fares you typed for getting to each airport, so you don't retype them.", "Until you clear your browser data"],
  ["compensair-consent", "Your browser's local storage", "Remembers that you chose to load Compensair's claim form.", "Until you clear your browser data"],
];

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie policy" intro="We only use cookies and similar storage that the site needs to work. No advertising or tracking cookies, and no analytics.">
      <h2>What we use</h2>
      <p>
        Under UK law (the Privacy and Electronic Communications Regulations), sites need your consent for cookies except those that are strictly necessary
        for a service you ask for. Everything below is in that category, so we don&apos;t show a cookie banner.
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

      <h2>Third-party cookies</h2>
      <ul>
        <li>
          <strong>Compensair:</strong> the claim form on our <Link href="/claim">claim page</Link> comes from Compensair&apos;s website and may set its own
          cookies. We only load it after you click to show it.
        </li>
        <li>
          <strong>Airlines and travel agents:</strong> when you click through to book, the seller&apos;s website (and Aviasales, which tracks the referral)
          sets its own cookies under its own policy.
        </li>
      </ul>

      <h2>Managing cookies</h2>
      <p>
        You can delete or block cookies in your browser settings. If you block the sign-in cookie, the members&apos; tools won&apos;t work; the rest of the
        site will. If we ever add analytics or other optional cookies, we&apos;ll ask for your consent first and update this page.
      </p>

      <h2>More about your data</h2>
      <p>See our <Link href="/privacy">privacy notice</Link>.</p>
    </LegalPage>
  );
}
