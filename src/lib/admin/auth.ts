import { headers } from "next/headers";
import { humanActor } from "@/lib/actions/record";
import { isAdminAuthorization } from "@/lib/site-access";

export class AdminAuthError extends Error {}

/**
 * Re-checks the admin login on every admin render and every admin Server
 * Action. src/proxy.ts already gates /admin, but a Server Action is its own
 * POST entry point (Next's data-security guide), so it verifies again here.
 * Returns the actor recorded on everything the owner does.
 */
export async function requireAdmin(): Promise<string> {
  const authorization = (await headers()).get("authorization");
  if (!isAdminAuthorization(authorization, process.env)) throw new AdminAuthError("Unauthorized");
  return humanActor("owner");
}
