// Compassionate refunds: what each airline on UK–South Asia routes publishes about refunds after a
// death, or when serious or terminal illness stops someone travelling. Taken from the airlines' own
// conditions of carriage, help and trade pages (checked October 2026). Most are discretionary and need
// documents; none of this is a legal right in the UK. Where an airline publishes nothing, we say so.

export type Event = "passenger_died" | "family_died" | "illness";

/**
 * full: a full refund is published. fees_waived: cancellation fees waived (the fare's own refund
 * rules still decide the rest). discretionary: the airline "may" refund or help. validity: tickets
 * can only be changed or extended. none: nothing published.
 */
export type Outcome = "full" | "fees_waived" | "discretionary" | "validity" | "none";

export interface AirlinePolicy {
  code: string; // IATA
  name: string;
  death: Outcome;
  deathText: string;
  illness: Outcome;
  illnessText: string;
  /** Who counts as immediate family, when the airline says. */
  family?: string;
  documents: string;
  how: string;
  sources: { label: string; url: string }[];
  /** Caveat about the source (e.g. an older or US-only document). */
  caveat?: string;
}

export const POLICIES: AirlinePolicy[] = [
  {
    code: "BA", name: "British Airways",
    death: "discretionary",
    deathText: "BA says it may be able to help when someone in your travelling party, or an immediate family member, has died. Its travel-agent guide says to send a refund request with a copy of the death certificate before travel; refunds go to the original payment method.",
    illness: "discretionary",
    illnessText: "BA has a dedicated line for changing or cancelling when a family member has died or been diagnosed with a terminal illness, and says it will do what it can.",
    documents: "Death certificate (or medical evidence for terminal illness).",
    how: "Call BA's bereavement line 0203 684 9677 (daily 08:00–20:00). If you booked through an agent, start with the agent.",
    sources: [
      { label: "BA contact us (bereavement line)", url: "https://www.britishairways.com/content/information/help-and-contacts/contact-us" },
      { label: "BA travel partner refunds", url: "https://www.britishairways.com/travel-partner-connect/en/ar/policies/procedures/refunds" },
    ],
  },
  {
    code: "VS", name: "Virgin Atlantic",
    death: "full",
    deathText: "Virgin's refund policy gives a full refund if the passenger dies before using the ticket, and covers a passenger who can't travel because an immediate family member or travelling companion has died. No administration fee is deducted for death or illness.",
    illness: "fees_waived",
    illnessText: "No administration fee when cancelling because of the illness of the passenger, an immediate family member or a travel companion; the fare's refund rules still apply.",
    documents: "Death certificate (or medical evidence for illness), sent to Virgin before travel.",
    how: "Contact Virgin Atlantic (or your agent) before the flight and send the death certificate.",
    sources: [{ label: "Virgin Atlantic global refund policy", url: "https://flywith.virginatlantic.com/eu/en/partner-hub/policies/refund-policy.html" }],
  },
  {
    code: "EK", name: "Emirates",
    death: "full",
    deathText: "Emirates' UK terms offer a refund or free rebooking if you or an immediate family member die before travel starts (a partial refund or free change after it starts). Its refund form says cancellation fees may be waived for the death of the passenger or a close family member, where the fare conditions allow.",
    illness: "none",
    illnessText: "No published illness waiver.",
    documents: "Death certificate or other evidence Emirates accepts.",
    how: "Use Emirates' online refund request form and attach the documents, or ask your agent.",
    sources: [
      { label: "Emirates UK terms and conditions", url: "https://www.emirates.com/us/english/information/uk-terms-and-conditions/" },
      { label: "Emirates refund request", url: "https://www.emirates.com/ae/english/help/forms/refund-request/" },
    ],
  },
  {
    code: "QR", name: "Qatar Airways",
    death: "full",
    deathText: "Qatar refunds the legal heirs once a death certificate is verified. For death or terminal illness, a waiver is requested first and the refund is then issued under the waiver code.",
    illness: "discretionary",
    illnessText: "Terminal illness can qualify for a waiver, approved case by case. Other illness isn't covered.",
    documents: "Death certificate, or medical evidence of terminal illness; proof of relationship for heirs.",
    how: "Contact your local Qatar Airways office (or your agent) and ask for a death / terminal illness waiver before the refund.",
    sources: [
      { label: "Qatar Airways penalties and charges (trade)", url: "https://www.qatarairways.com/tradeportal/en/bookingnticketing/Penalties-and-Charges.html" },
      { label: "Qatar Airways NDC support (waivers)", url: "https://www.qatarairways.com/tradeportal/en-us/ndc-oryx-connect/NDCsupport.html" },
    ],
  },
  {
    code: "EY", name: "Etihad",
    death: "full",
    deathText: "Full refund if the passenger, or an immediate family member, dies before travel starts. Change and refund fees are waived.",
    illness: "none",
    illnessText: "No published illness waiver for tickets.",
    documents: "Death certificate and proof of relationship.",
    how: "Contact Etihad (or your agent) with the documents.",
    sources: [
      { label: "Etihad conditions of carriage", url: "https://www.etihad.com/en-us/legal/conditions-of-carriage" },
      { label: "Etihad changes guide", url: "https://www.etihad.com/en/help/faq/modification-guide" },
    ],
  },
  {
    code: "TK", name: "Turkish Airlines",
    death: "full",
    deathText: "If the passenger or a first-degree relative dies before departure, the amount paid is refunded in full; after the first flight, the unused flights are refunded.",
    illness: "discretionary",
    illnessText: "An older Turkish tariff gives a full refund for illness of the passenger or immediate family with a medical certificate; it may not apply to all fares today.",
    family: "First-degree relatives.",
    documents: "Death certificate (heirs: certificate of inheritance); medical report for illness.",
    how: "Request the refund from Turkish Airlines or your agent, attaching the documents.",
    sources: [
      { label: "Turkish Airlines: ticket process in the event of a death", url: "https://www.turkishairlines.com/en-us/any-questions/expatriation-services-and-ticket-process-in-the-event-of-a-death/" },
      { label: "Turkish Airlines tariff TK1 (illness)", url: "https://cdn.turkishairlines.com/m/453a227e533cce37/original/TK-TK1-1-2-pdf.pdf" },
    ],
    caveat: "The illness rule comes from an older tariff filing.",
  },
  {
    code: "AI", name: "Air India",
    death: "discretionary",
    deathText: "Air India may waive its charges when you can't travel because an immediate family member died; after travel starts, tickets can be extended with a death certificate.",
    illness: "discretionary",
    illnessText: "Charges may be waived for a medical emergency or sudden illness that stops you travelling.",
    family: "Spouse, child, parent, sibling, grandparent or grandchild.",
    documents: "Death certificate or medical documents.",
    how: "Request the refund in Manage booking (or through your agent) and ask for the charges to be waived, with documents.",
    sources: [{ label: "Air India conditions of carriage", url: "https://www.airindia.com/content/dam/air-india/pdfs/general-conditions-of-carriage-for-passengers-and-baggages.pdf" }],
  },
  {
    code: "UL", name: "SriLankan Airlines",
    death: "discretionary",
    deathText: "SriLankan may waive cancellation fees when the passenger or a close family member dies between booking and travel; with a government-certified death certificate it gives a full refund without penalties.",
    illness: "none",
    illnessText: "No published illness waiver.",
    family: "Spouse, children, parents, siblings, grandparents, grandchildren and in-laws.",
    documents: "Government-certified death certificate (without it, standard penalties apply).",
    how: "On the online refund form choose “Due to death of immediate family member” (tickets bought on srilankan.com), or ask your agent. Request within a year of buying.",
    sources: [{ label: "SriLankan Airlines FAQ", url: "https://www.srilankan.com/en_uk/Corporate/faq-details?type=12" }],
  },
  {
    code: "PK", name: "Pakistan International Airlines (PIA)",
    death: "full",
    deathText: "PIA's fare rules charge no penalty when the passenger or an immediate family member dies; its booking conditions allow cancellation and no-show waivers only for death.",
    illness: "validity",
    illnessText: "No penalty if a family member on the same flight is hospitalised; some routes accept a hospital certificate showing you were unfit to travel.",
    family: "Spouse, children or parents.",
    documents: "Death or burial certificate, and proof of relationship.",
    how: "Contact PIA or your agent with the documents.",
    sources: [
      { label: "PIA fare rules", url: "https://www.piac.com.pk/fare-rules" },
      { label: "PIA booking conditions", url: "https://www.piac.com.pk/facilities/booking-conditions" },
    ],
  },
  {
    code: "LH", name: "Lufthansa",
    death: "full",
    deathText: "Lufthansa's tariff gives a full refund for death of the passenger, an immediate family member or a travelling companion, with a death certificate.",
    illness: "full",
    illnessText: "The same tariff gives a full refund for illness backed by a medical certificate.",
    documents: "Death or medical certificate.",
    how: "Submit a refund request with the certificate (Lufthansa's alternative refund form, or your agent).",
    sources: [
      { label: "Lufthansa tariff (death or illness)", url: "https://www.lufthansa.com/content/dam/lh/documents/pdf-americas/ca/LUFTHANSA-AIRLINES-PUBLISHING-COMPANY-AGENT-INTERNATIONAL-PASSENGER-RULES-AND-FARES-CTA18.pdf" },
      { label: "Lufthansa customer relations", url: "https://www.lufthansa.com/us/en/local-page/customer-relations-usa" },
    ],
    caveat: "From a North American tariff; check it applies to a UK booking.",
  },
  {
    code: "KL", name: "KLM",
    death: "discretionary",
    deathText: "If the passenger dies, KLM lists an exceptional refund. A family member's death or a medical reason can extend the ticket's validity; Light and Standard tickets are otherwise non-refundable.",
    illness: "validity",
    illnessText: "A medical reason can extend the ticket's validity.",
    documents: "Death certificate or medical certificate.",
    how: "Contact KLM or your agent in writing.",
    sources: [{ label: "KLM refund and compensation", url: "https://www.klm.com/information/refund-compensation" }],
  },
  {
    code: "IX", name: "Air India Express", death: "discretionary", deathText: "Follows Air India's conditions: charges may be waived for a death in the immediate family.", illness: "discretionary", illnessText: "Charges may be waived for a sudden illness or medical emergency.", documents: "Death certificate or medical documents.", how: "Contact the airline or your agent.",
    sources: [{ label: "Air India conditions of carriage", url: "https://www.airindia.com/content/dam/air-india/pdfs/general-conditions-of-carriage-for-passengers-and-baggages.pdf" }],
    caveat: "Assumed to follow Air India's group conditions.",
  },
  {
    code: "6E", name: "IndiGo", death: "none", deathText: "No published bereavement refund.", illness: "discretionary", illnessText: "If you or a family member on the same booking is hospitalised during the travel period, IndiGo may give a refund or credit shell.", documents: "Hospital documents.", how: "Contact IndiGo customer support with the documents.",
    sources: [{ label: "IndiGo conditions of carriage", url: "https://www.goindigo.in/information/conditions-of-carriage.html" }],
  },
  {
    code: "GF", name: "Gulf Air", death: "validity", deathText: "Only ticket changes are published: if a passenger dies during the trip, companions' tickets can be changed. Non-refundable fares get refundable taxes only.", illness: "none", illnessText: "No published illness waiver.", documents: "Death certificate.", how: "Ask the Gulf Air contact centre (or your agent) for an exception.",
    sources: [{ label: "Gulf Air refund policy", url: "https://www.gulfair.com/transparency/Refund-policy" }],
  },
  {
    code: "SV", name: "Saudia", death: "none", deathText: "No published bereavement refund.", illness: "validity", illnessText: "A medical certificate can extend the ticket for up to three months, for the patient and family travelling with them.", documents: "Medical certificate.", how: "Contact Saudia Guest Care or a sales office.",
    sources: [{ label: "Saudia general conditions of carriage", url: "https://www.saudia.com/help/useful-links/legal-and-terms-and-conditions/general-conditions-of-carriage" }],
  },
  {
    code: "WY", name: "Oman Air", death: "validity", deathText: "Tickets can be changed or extended (up to 45 days) after a death during travel; refunds follow the fare rules.", illness: "none", illnessText: "No published illness waiver.", documents: "Death certificate.", how: "Ask Oman Air (or your agent) for an exception.",
    sources: [{ label: "Oman Air conditions of carriage", url: "https://www.omanair.com/en/conditions-carriage" }],
  },
  {
    code: "KU", name: "Kuwait Airways", death: "validity", deathText: "Tickets can be changed or extended (up to 45 days) after a death; refunds follow the fare rules.", illness: "none", illnessText: "No published illness waiver.", documents: "Death certificate.", how: "Email the refund section (ibe_refund@kuwaitairways.com) with the death certificate.",
    sources: [{ label: "Kuwait Airways conditions of carriage", url: "https://kuwaitairways.com/en/terms/conditions-of-carriage" }],
  },
  {
    code: "BG", name: "Biman Bangladesh Airlines", death: "discretionary", deathText: "Biman's international tariff has a “Refund in case of death” rule, but its terms aren't published in a readable form online.", illness: "none", illnessText: "No published illness waiver.", documents: "Death certificate.", how: "Ask Biman's refund team (or your agent) to apply the death refund rule.",
    sources: [{ label: "Biman international tariff", url: "https://www.biman-airlines.com/assets/pdf/terms-conditions/Biman-International-Tariff-Manual.pdf" }],
  },
];

export const policyFor = (code: string | null | undefined) => POLICIES.find((p) => p.code === code?.toUpperCase()) ?? null;

export const OUTCOME_LABEL: Record<Outcome, string> = {
  full: "Full refund published",
  fees_waived: "Cancellation fees waived",
  discretionary: "At the airline's discretion",
  validity: "Ticket changes only",
  none: "Nothing published",
};

export interface CompassionateRange {
  outcome: Outcome;
  text: string;
  /** What you can count on (unused taxes) and the most you might get. */
  min: number;
  max: number;
}

/**
 * The likely range for a booking. `taxesBack` is what any non-flyer gets anyway (APD etc.);
 * `refundableTotal` is what the fare's own rules give back (null if non-refundable).
 */
export function compassionateRange(p: AirlinePolicy, event: Event, pricePaid: number, taxesBack: number, refundableTotal: number | null): CompassionateRange {
  const outcome = event === "illness" ? p.illness : p.death;
  const text = event === "illness" ? p.illnessText : p.deathText;
  const floor = Math.max(taxesBack, refundableTotal ?? 0);
  // Full, fee-waived and discretionary refunds can all reach the whole price; validity-only and
  // unpublished policies leave you with what the fare rules and unused taxes give anyway.
  // "Fees waived" only removes the cancellation fee: a non-refundable fare stays non-refundable.
  const max = outcome === "validity" || outcome === "none" ? floor : outcome === "fees_waived" && refundableTotal == null ? floor : pricePaid;
  return { outcome, text, min: outcome === "full" ? pricePaid : floor, max };
}
