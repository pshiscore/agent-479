/**
 * Scheduled jobs run only when CRON_ENABLED is exactly "true". Anything else,
 * including unset, means each cron route logs "disabled" and returns at once.
 * Production keeps it "false" until launch (docs/PREDEPLOY_CHECKLIST.md).
 */
export function cronEnabled(value = process.env.CRON_ENABLED): boolean {
  return value === "true";
}

/** The response a cron route returns while jobs are off. */
export function cronDisabledResponse(job: string): Response {
  console.log(`cron ${job}: disabled (CRON_ENABLED is not "true")`);
  return Response.json({ job, disabled: true });
}
