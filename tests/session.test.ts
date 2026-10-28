import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth";
import { readSession, signSession } from "@/lib/session";

describe("member sessions", () => {
  const key = "test-secret";
  it("round-trips a signed session and expires it after 30 days", () => {
    const c = signSession({ uid: "u1", email: "a@b.com" }, 0, key);
    expect(readSession(c, 1000, key)).toMatchObject({ uid: "u1", email: "a@b.com" });
    expect(readSession(c, 31 * 86_400_000, key)).toBeNull();
  });

  it("rejects tampered or foreign cookies", () => {
    const c = signSession({ uid: "u1", email: "a@b.com" }, 0, key);
    const [payload, sig] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", email: "x@y.com", exp: 9e15 })).toString("base64url");
    expect(readSession(`${forged}.${sig}`, 1000, key)).toBeNull();
    expect(readSession(`${payload}.${sig}`, 1000, "other-secret")).toBeNull();
    expect(readSession("garbage", 1000, key)).toBeNull();
    expect(readSession(undefined, 1000, key)).toBeNull();
  });

  it("only redirects within the site after sign-in", () => {
    expect(safeNext("/refund-calculator?price=500")).toBe("/refund-calculator?price=500");
    expect(safeNext("https://evil.example")).toBe("/refund-calculator");
    expect(safeNext("//evil.example")).toBe("/refund-calculator");
    expect(safeNext(undefined)).toBe("/refund-calculator");
  });
});
