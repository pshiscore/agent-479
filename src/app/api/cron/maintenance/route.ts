import { isAuthorizedCron } from "@/lib/cron-auth";
import { cronDisabledResponse, cronEnabled } from "@/lib/cron-enabled";
import { getDb } from "@/lib/db/client";
import { runMaintenanceJob } from "@/lib/pipeline/maintenance";

export const maxDuration = 300;

/** Daily maintenance (description purge so far). Not scheduled until build step 23. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  if (!cronEnabled()) return cronDisabledResponse("maintenance");
  const result = await runMaintenanceJob(getDb());
  if (!result) return Response.json({ skipped: "another maintenance job is running" }, { status: 409 });
  return Response.json(result);
}
