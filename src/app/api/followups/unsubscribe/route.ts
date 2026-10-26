import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

// Unsubscribe by the link's token: from the /unsubscribe page's form (sent back to the page)
// or from email apps' one-click button (List-Unsubscribe-Post), which just needs a 200.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const fromPage = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") && !(await request.clone().text()).includes("List-Unsubscribe=One-Click");
  const ok = token.length > 0 && token.length <= 100 && (await getStore().unsubscribeFollowup(token));
  if (fromPage) {
    const back = new URL(`/unsubscribe?token=${encodeURIComponent(token)}&${ok ? "done=1" : "error=1"}`, request.url);
    return NextResponse.redirect(back, 303);
  }
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "This link has expired or was already used." }, { status: 404 });
}
