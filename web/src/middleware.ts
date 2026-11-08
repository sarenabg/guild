import { NextResponse, type NextRequest } from "next/server";

// Share a demo sandbox: any page with ?sandbox=<id> opens that sandbox
// (it sets the visitor cookie, then drops the parameter from the address).
export function middleware(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("sandbox");
  if (!id || !/^[a-z0-9]{12,40}$/.test(id)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.searchParams.delete("sandbox");
  const res = NextResponse.redirect(url);
  res.cookies.set("guild_sid", id, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 7 * 24 * 3600, path: "/" });
  return res;
}

export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
