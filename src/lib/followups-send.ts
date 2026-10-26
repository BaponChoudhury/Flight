// Sends the follow-up emails that are due. Used by the daily job and Admin's "send now".

import { getAirportIndex } from "@/lib/airports-index";
import { emailConfigured, renderFollowupEmail, sendEmail, siteUrl } from "@/lib/followups";
import type { Store } from "@/lib/store";

export async function sendDueFollowups(store: Store, today = new Date().toISOString().slice(0, 10)) {
  if (!emailConfigured()) return { sent: 0, failed: 0, skipped: "Email isn't set up: add RESEND_API_KEY and EMAIL_FROM." };
  const due = await store.listDueFollowups(today, 100);
  let names: Map<string, string> = new Map();
  try {
    names = new Map((await getAirportIndex(store)).map((a) => [a.code, a.city]));
  } catch {
    /* airport names are a nicety; codes still work */
  }
  const cityOf = (code: string) => names.get(code) ?? code;
  let sent = 0;
  let failed = 0;
  for (const f of due) {
    if (!f.email) continue;
    const page = `${siteUrl()}/unsubscribe?token=${encodeURIComponent(f.unsubscribe_token)}`;
    const oneClick = `${siteUrl()}/api/followups/unsubscribe?token=${encodeURIComponent(f.unsubscribe_token)}`;
    try {
      await sendEmail(f.email, renderFollowupEmail(f, page, cityOf), oneClick);
      await store.markFollowupSent(f.id);
      sent++;
    } catch (err) {
      failed++;
      console.warn(`follow-up ${f.id} not sent: ${(err as Error).message}`);
    }
  }
  return { sent, failed, skipped: null as string | null };
}
