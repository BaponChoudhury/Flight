import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { LEGAL } from "@/lib/config/legal";

export const metadata = { title: "Privacy notice · Fly To Roots" };

const DATA: [string, string, string, string][] = [
  [
    "Searching",
    "Your town or postcode (or chosen airports), destination, dates, number and type of passengers, bags and search options. We don't ask for your name to search.",
    "To find flights and work out door-to-door costs. A record of each search (without your IP address or name) helps us run, fix and improve the service.",
    "Legitimate interests",
  ],
  [
    "Your IP address when you search",
    "Your IP address, passed with the search to one of our flight price partners, as their service requires.",
    "So the partner can return prices and apply its fair-use limits. We don't store it in our search records.",
    "Legitimate interests",
  ],
  [
    "Booking clicks",
    "A random reference number plus the trip you clicked (route, dates, price, number of passengers).",
    "To check which bookings earned us commission. It doesn't identify you.",
    "Legitimate interests",
  ],
  [
    "Compensation follow-up emails",
    "Your email address and the flights on the trip you opted in for.",
    "To send one email after your trip about checking for compensation. Your email address is deleted once it's sent or you unsubscribe.",
    "Consent (you can withdraw it at any time)",
  ],
  [
    "Your account (refund calculator)",
    "Your email address, an account ID, when you joined and last signed in.",
    "To sign you in with an email link and give you the members' tools.",
    "Contract (providing the service you asked for)",
  ],
  [
    "Marketing emails",
    "Your email address and when you agreed, only if you ticked the box.",
    "To send cheap fares and travel tips. Every email has an unsubscribe link.",
    "Consent (you can withdraw it at any time)",
  ],
  [
    "Contacting us",
    "Whatever you include in your message.",
    "To reply and keep a record of the conversation.",
    "Legitimate interests",
  ],
];

const PROCESSORS: [string, string, string][] = [
  ["Website hosting", "Running the website (servers may be in the US).", "Pages, searches and short-lived server logs, which include IP addresses."],
  ["Database and sign-in", "Storing data and sending sign-in emails.", "Search records, booking clicks, follow-ups, accounts and marketing choices."],
  ["Email delivery", "Sending the emails you ask for (may be in the US).", "Email addresses and email content."],
  ["Flight price and booking partners", "Finding flight prices and booking links.", "Search details; one partner also receives your IP address."],
  ["Postcode lookup", "Finding your nearest airports.", "The town or postcode you type."],
];

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" intro="What personal data we collect, why, who we share it with, and your rights under UK data protection law (UK GDPR and the Data Protection Act 2018).">
      <h2>Who is responsible for your data</h2>
      <p>
        {LEGAL.owner}, {LEGAL.address}, is the controller of your personal data on {LEGAL.siteName}. ICO registration number: {LEGAL.icoNumber}. For
        anything about your data, email {LEGAL.email}.
      </p>

      <h2>What we collect and why</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>When</th><th>What</th><th>Why</th><th>Lawful basis</th></tr>
          </thead>
          <tbody>
            {DATA.map(([when, what, why, basis]) => (
              <tr key={when}><td className="font-semibold">{when}</td><td>{what}</td><td>{why}</td><td>{basis}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>We don&apos;t sell your personal data, and we don&apos;t use it for automated decisions that significantly affect you.</p>

      <h2>When you book or claim elsewhere</h2>
      <p>
        When you click through to an airline, travel agent or Compensair, you give your details to them, not to us. They are responsible for that data under
        their own privacy policies. Compensair&apos;s claim form on our <Link href="/claim">claim page</Link> is loaded from Compensair&apos;s website, so
        what you type there goes straight to them.
      </p>

      <h2>Who we share data with</h2>
      <p>We use these types of service provider. They process data only to provide their service to us. You can ask us for their names.</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Type of provider</th><th>What for</th><th>What they receive</th></tr>
          </thead>
          <tbody>
            {PROCESSORS.map(([name, role, data]) => (
              <tr key={name}><td className="font-semibold">{name}</td><td>{role}</td><td>{data}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>We may also share data if the law requires it, or to protect our rights or the safety of others.</p>

      <h2>International transfers</h2>
      <p>
        Some providers process data outside the UK, for example in the US or the EU. Where they do, we rely on UK adequacy regulations (including the UK
        extension to the EU–US Data Privacy Framework) or the UK International Data Transfer Agreement or Addendum.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li><strong>Follow-up email addresses:</strong> deleted once the email is sent or you unsubscribe.</li>
        <li><strong>Search records and booking clicks</strong> (which don&apos;t include your name, email or IP address): up to 24 months.</li>
        <li><strong>Accounts:</strong> until you ask us to delete yours.</li>
        <li><strong>Marketing consent:</strong> until you unsubscribe, plus a record that you did so we don&apos;t email you again.</li>
        <li><strong>Server logs</strong> kept by our host: a short period, for security and troubleshooting.</li>
      </ul>

      <h2>Your rights</h2>
      <p>You can ask us to:</p>
      <ul>
        <li>give you a copy of your personal data;</li>
        <li>correct it, or delete it;</li>
        <li>restrict or object to how we use it (including any marketing, at any time);</li>
        <li>send it to you or another organisation in a reusable format;</li>
        <li>stop processing based on your consent (withdrawing consent doesn&apos;t affect what we did before).</li>
      </ul>
      <p>Email {LEGAL.email}. We&apos;ll reply within one month. It&apos;s free.</p>
      <p>
        If you&apos;re unhappy with how we handle your data, please tell us first. You can also complain to the Information Commissioner&apos;s Office:{" "}
        <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>, or call 0303 123 1113.
      </p>

      <h2>Cookies</h2>
      <p>We only use what&apos;s needed for the site to work. See our <Link href="/cookies">cookie policy</Link>.</p>

      <h2>Children</h2>
      <p>The site is meant for adults booking travel. Accounts and email sign-ups are for people aged 18 or over.</p>

      <h2>Security</h2>
      <p>Data is sent over encrypted connections, access to our database is restricted, and sign-in uses one-time email links rather than passwords.</p>

      <h2>Changes</h2>
      <p>We&apos;ll update this notice when what we do changes, and change the date at the top.</p>
    </LegalPage>
  );
}
