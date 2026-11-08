import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { LedgerError } from "./ledger";
import { InputError } from "./actions";
import { isWorldId } from "./store";

/** Run a handler; turn rule and input errors into a plain 400 message. */
export async function handle(fn: () => Promise<unknown> | unknown) {
  try {
    const out = await fn();
    if (out === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof LedgerError || e instanceof InputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[guild]", e);
    return NextResponse.json({ error: "Something went wrong on the server" }, { status: 500 });
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The visitor's private demo world. A cookie remembers it for a week. */
export async function visitor(): Promise<string> {
  const jar = await cookies();
  const have = jar.get("guild_sid")?.value;
  if (have && isWorldId(have)) return have;
  const id = crypto.randomBytes(12).toString("hex");
  jar.set("guild_sid", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600, path: "/" });
  return id;
}

/** A NEAR account name from the query string, or null. */
export function accountParam(req: Request): string | null {
  const a = new URL(req.url).searchParams.get("account")?.trim().toLowerCase() ?? "";
  return /^[a-z0-9._-]{2,64}$/.test(a) ? a : null;
}
