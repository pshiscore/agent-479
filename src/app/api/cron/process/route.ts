import { isAuthorizedCron } from "@/lib/cron-auth";
import { cronDisabledResponse, cronEnabled } from "@/lib/cron-enabled";
import { getDb } from "@/lib/db/client";
import { runProcessJob } from "@/lib/pipeline/process";

export const maxDuration = 300;

/** Maps, filters, and resolves venues for a batch of raw records. Not scheduled until build step 23. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  if (!cronEnabled()) return cronDisabledResponse("process");
  const result = await runProcessJob(getDb());
  if (!result) return Response.json({ skipped: "another process job is running" }, { status: 409 });
  return Response.json(result);
}
