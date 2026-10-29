import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// Lets the hidden /admin page check the password before showing anything.
export async function GET(request: Request) {
  return requireAdmin(request) ?? NextResponse.json({ ok: true });
}
