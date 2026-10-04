import { isAuthorizedCron } from "@/lib/cron-auth";
import { cronDisabledResponse, cronEnabled } from "@/lib/cron-enabled";
import { getDb } from "@/lib/db/client";
import { runFetchJob } from "@/lib/pipeline/fetch";

// The job stops starting new sources after 240 s, leaving room to finish one.
export const maxDuration = 300;

/** Fetches due, enabled sources. Not scheduled until build step 23 turns crons on. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  if (!cronEnabled()) return cronDisabledResponse("fetch");
  const result = await runFetchJob(getDb());
  if (!result) return Response.json({ skipped: "another fetch job is running" }, { status: 409 });
  return Response.json(result);
}
