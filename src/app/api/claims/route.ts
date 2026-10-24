import { NextResponse } from "next/server";
import { buildApplication, compensairConfigured, CompensairError, newClaimRef, submitApplication, type ClaimInput } from "@/lib/compensair";

export const runtime = "nodejs";

// A passenger's compensation claim, sent straight to Compensair with our partner token.
// Nothing about the passenger is stored here; Compensair holds the claim.
export async function POST(request: Request) {
  if (!compensairConfigured()) return NextResponse.json({ error: "Compensation claims aren't available right now." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as (ClaimInput & { consent?: boolean }) | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "Please agree to send your details to Compensair." }, { status: 400 });
  const ref = newClaimRef();
  const app = buildApplication(body, ref);
  if (typeof app === "string") return NextResponse.json({ error: app }, { status: 400 });
  try {
    const reply = await submitApplication(app);
    const id = reply && typeof reply === "object" && "id" in reply ? String((reply as { id: unknown }).id) : null;
    return NextResponse.json({ reference: ref, compensairId: id }, { status: 201 });
  } catch (err) {
    console.error("compensair submit failed", (err as Error).message);
    const status = err instanceof CompensairError && err.status === 400 ? 400 : 502;
    return NextResponse.json(
      { error: status === 400 ? "Compensair couldn't accept these details. Please check them and try again." : "We couldn't reach Compensair. Please try again in a few minutes." },
      { status },
    );
  }
}
