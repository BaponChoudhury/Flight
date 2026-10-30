import { NextResponse, type NextRequest } from "next/server";

// Optional password gate for the whole app (Phase 1 has no accounts).
// Set APP_PASSWORD to require HTTP basic auth (any username).
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Fly To Roots"' },
  });
}

// Unsubscribe links in emails and the daily job must work even while the site is password-protected
// (the job has its own CRON_SECRET; unsubscribe needs the link's token).
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|unsubscribe|api/followups/unsubscribe|api/cron).*)"] };
