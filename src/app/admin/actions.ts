"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { rollbackAction } from "@/lib/actions/rollback";
import { requireAdmin } from "@/lib/admin/auth";
import { labelPair } from "@/lib/admin/dedup-review";
import { decideProposal } from "@/lib/admin/proposals";
import { getDb } from "@/lib/db/client";

/**
 * Admin Server Actions. Each is its own POST entry point, so each re-checks
 * the admin login (requireAdmin), validates its input, takes only an ID and
 * the owner's note from the form, and re-reads everything else from the
 * database. Results come back as a message on the page.
 */

const uuid = z.uuid();
const back = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export async function rollback(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("actionId"));
  const reason = String(formData.get("reason") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/admin/agent-log");
  const path = returnTo.startsWith("/admin/agent-log") ? returnTo.split("?")[0] : "/admin/agent-log";
  let target: string;
  try {
    if (!id.success) throw new Error("bad action id");
    const logged = await rollbackAction(getDb(), id.data, { actor, reason });
    target = back(path, { msg: `Rolled back. Logged as ${logged.action} ${logged.id.slice(0, 8)}.` });
  } catch (err) {
    target = back(path, { error: `Rollback refused: ${message(err)}` });
  }
  redirect(target);
}

export async function decide(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("proposalId"));
  const decision = formData.get("decision") === "approved" ? "approved" : formData.get("decision") === "rejected" ? "rejected" : null;
  const note = String(formData.get("note") ?? "");
  let target: string;
  try {
    if (!id.success || !decision) throw new Error("bad request");
    const r = await decideProposal(getDb(), id.data, decision, { actor, note });
    target = back("/admin/proposals", { msg: `${decision === "approved" ? "Approved" : "Rejected"}: ${r.effect}.` });
  } catch (err) {
    target = back("/admin/proposals", { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}

export async function labelDedupPair(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("candidateId"));
  const label = formData.get("label") === "same" ? "same" : formData.get("label") === "different" ? "different" : null;
  const note = String(formData.get("note") ?? "");
  let target: string;
  try {
    if (!id.success || !label) throw new Error("bad request");
    await labelPair(getDb(), id.data, label, { actor, note });
    target = back("/admin/dedup-review", { msg: `Labeled ${label}.` });
  } catch (err) {
    target = back("/admin/dedup-review", { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}
