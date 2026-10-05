import { connection } from "next/server";
import { isIndexable } from "@/lib/site-access";

/** robots.txt disallows everything unless the site is indexable (unlocked, production, SITE_INDEXING=true). Read per request. */
export async function GET() {
  await connection();
  const body = !isIndexable(process.env)
    ? "User-agent: *\nDisallow: /\n"
    : "User-agent: *\nDisallow: /admin\nDisallow: /api/\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
