import { isAuthorizedCron } from "@/lib/cron-auth";
import { cronDisabledResponse, cronEnabled } from "@/lib/cron-enabled";
import { getDb } from "@/lib/db/client";
import { runWeatherJob } from "@/lib/weather/job";

// A literal (Next reads it statically); equal to CRON_MAX_DURATION_S. The job
// stops starting new work at 60% of it (src/lib/cron-budget.ts).
export const maxDuration = 300;

/** Event weather from the National Weather Service: hourly forecasts and Arkansas alerts, every 30 minutes. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  if (!cronEnabled()) return cronDisabledResponse("weather");
  const result = await runWeatherJob(getDb());
  if (!result) return Response.json({ skipped: "another weather job is running" }, { status: 409 });
  return Response.json(result);
}
