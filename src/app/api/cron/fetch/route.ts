import { isAuthorizedCron } from "@/lib/cron-auth";
import { cronDisabledResponse, cronEnabled } from "@/lib/cron-enabled";
import { getDb } from "@/lib/db/client";
import { runFetchJob } from "@/lib/pipeline/fetch";

// A literal (Next reads it statically); equal to CRON_MAX_DURATION_S. The job
// stops starting new sources at 60% of it (src/lib/cron-budget.ts).
export const maxDuration = 300;

/** Fetches due, enabled sources. Not scheduled until build step 23 turns crons on. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  if (!cronEnabled()) return cronDisabledResponse("fetch");
  const result = await runFetchJob(getDb());
  if (!result) return Response.json({ skipped: "another fetch job is running" }, { status: 409 });
  return Response.json(result);
}
