import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
