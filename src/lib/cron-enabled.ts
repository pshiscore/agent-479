/**
 * Scheduled jobs run only when CRON_ENABLED is "true" (any capitalization,
 * surrounding spaces or quotes ignored: a value typed into a dashboard as
 * "True" or "\"true\"" means on). Anything else, including unset, means each
 * cron route logs "disabled", with the value it saw, and returns at once.
 */
const normalize = (value: string | undefined) => (value ?? "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase();

export function cronEnabled(value = process.env.CRON_ENABLED): boolean {
  return normalize(value) === "true";
}

/** The response a cron route returns while jobs are off. The switch isn't a secret, so its value is logged. */
export function cronDisabledResponse(job: string, value = process.env.CRON_ENABLED): Response {
  console.log(`cron ${job}: disabled (CRON_ENABLED is ${value === undefined ? "unset" : JSON.stringify(value)}, not "true")`);
  return Response.json({ job, disabled: true });
}
