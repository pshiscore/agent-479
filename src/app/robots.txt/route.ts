import { connection } from "next/server";
import { isSiteLocked } from "@/lib/site-access";

/** While the site is locked, robots.txt disallows everything. Read per request, never prerendered. */
export async function GET() {
  await connection();
  const body = isSiteLocked(process.env)
    ? "User-agent: *\nDisallow: /\n"
    : "User-agent: *\nDisallow: /admin\nDisallow: /api/\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
