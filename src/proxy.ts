import { type NextRequest, NextResponse } from "next/server";
import { decideAccess } from "@/lib/site-access";

/**
 * The site lock and the admin gate (src/lib/site-access.ts). Runs on every
 * request: no matcher, so nothing new slips past the lock.
 */
export function proxy(request: NextRequest) {
  const decision = decideAccess(request.nextUrl.pathname, request.headers.get("authorization"), process.env);
  let response: NextResponse;
  if (decision.allow) {
    response = NextResponse.next();
  } else if (decision.status === 401) {
    response = new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="${decision.realm}", charset="UTF-8"` },
    });
  } else {
    response = new NextResponse(decision.message, { status: 503 });
  }
  if (decision.noindex) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!decision.allow) response.headers.set("Cache-Control", "no-store");
  return response;
}
