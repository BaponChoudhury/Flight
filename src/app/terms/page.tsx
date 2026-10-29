import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { LEGAL } from "@/lib/config/legal";

export const metadata = { title: "Terms and conditions · Flights to India" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms and conditions" intro={`The rules for using ${LEGAL.siteName}. Please read them before you search or book.`}>
      <h2>1. Who we are</h2>
      <p>
        {LEGAL.siteName} is run by {LEGAL.owner}, {LEGAL.address} (&quot;we&quot;, &quot;us&quot;). You can contact us at {LEGAL.email}. By using this
        website you agree to these terms. If you don&apos;t agree, please don&apos;t use the site.
      </p>

      <h2>2. What we do, and what we don&apos;t</h2>
      <p>
        We are a flight comparison and information service. We search several flight sources, suggest routes (including split tickets), and link you to
        airlines and travel agents (&quot;sellers&quot;) to book.
      </p>
      <ul>
        <li><strong>We don&apos;t sell flights.</strong> When you book, your contract is with the seller, under their terms and fare rules. Payments, tickets, changes, refunds and customer service are the seller&apos;s responsibility.</li>
        <li><strong>ATOL:</strong> because we don&apos;t sell flights or packages, ATOL protection doesn&apos;t come from us. Check with the seller whether your booking is protected.</li>
        <li><strong>We don&apos;t give legal or financial advice.</strong> Our refund calculator, ticket rules and compensation information are general estimates to help you; they aren&apos;t legal advice.</li>
      </ul>

      <h2>3. Prices and information</h2>
      <ul>
        <li>Prices come from third parties and change often. The price, baggage allowance and fare rules shown by the seller when you pay are the ones that apply.</li>
        <li>Door-to-door costs for getting to the airport are estimates unless you enter your own fares.</li>
        <li>We try hard to keep information accurate, but we can&apos;t guarantee that every price, schedule, rule or connection time is complete, current or error-free.</li>
      </ul>

      <h2>4. Split tickets and self-transfer</h2>
      <p>
        Some routes use separate tickets. If your first flight is late and you miss the next one, the second airline doesn&apos;t have to help, and you may
        have to buy a new ticket. You may also need to collect bags and check in again. We check connection times against our minimums, but you choose and
        book these routes at your own risk. Consider leaving extra time and buying travel insurance.
      </p>

      <h2>5. How we make money</h2>
      <p>
        Searching is free. We may earn a commission when you book through some of our links to flight partners and travel agents, or when you
        make a claim through our partner Compensair. This never changes the price you pay. Where the same flight costs about the same from two sources, we
        may show the one that earns us commission.
      </p>

      <h2>6. Accounts</h2>
      <p>
        Some tools, such as the refund calculator, need you to sign in with an email link. Keep access to your email account secure: anyone who can open the
        link can sign in as you. We may suspend accounts that misuse the site. You can ask us to delete your account at any time (see our{" "}
        <Link href="/privacy">privacy notice</Link>).
      </p>

      <h2>7. Compensation claims</h2>
      <p>
        Compensation claims are handled by our partner Compensair, under their own terms and fees. We pass you to their form; we aren&apos;t a party to your
        claim and don&apos;t guarantee its outcome.
      </p>

      <h2>8. Using the site fairly</h2>
      <ul>
        <li>Don&apos;t scrape the site, run automated searches, overload it, or try to get around access controls.</li>
        <li>Don&apos;t use the site for anything unlawful or to mislead others.</li>
        <li>We may limit how many searches you can run, or block access, to protect the service.</li>
      </ul>

      <h2>9. Third-party websites</h2>
      <p>We link to sites we don&apos;t control (airlines, agents, Compensair, rail and coach operators). Their terms and privacy policies apply when you use them.</p>

      <h2>10. Our liability to you</h2>
      <ul>
        <li>Nothing in these terms limits liability that can&apos;t be limited by law, including for death or personal injury caused by our negligence, fraud, or your statutory rights as a consumer.</li>
        <li>We aren&apos;t responsible for the acts or omissions of sellers, airlines or other third parties, including delays, cancellations, missed connections, price changes or refusals to refund.</li>
        <li>As the service is free, and to the extent the law allows, we aren&apos;t liable for indirect or unforeseeable losses, or for business losses.</li>
      </ul>

      <h2>11. Intellectual property</h2>
      <p>The site&apos;s design, text and code belong to us or our licensors. Airline names and logos belong to their owners and are used only to identify flights.</p>

      <h2>12. Changes and availability</h2>
      <p>We may change the site or these terms. The version shown here, with its date, applies to your use at that time. We may pause the service for maintenance or if a data source stops working.</p>

      <h2>13. Complaints and law</h2>
      <p>
        If something goes wrong, email us at {LEGAL.email} and we&apos;ll try to put it right. These terms are governed by the law of England and Wales.
        If you live in Scotland or Northern Ireland you can also bring proceedings in your local courts.
      </p>
    </LegalPage>
  );
}
