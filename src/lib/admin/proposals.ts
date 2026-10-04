import { and, eq } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions, rawRecords } from "@/lib/db/schema";
import { linkTicketmasterVenue } from "@/lib/sources/ticketmaster-venues";

/**
 * The owner approves or rejects a pending proposal from /admin/proposals. The
 * decision is stamped on the proposal (approval_status, reviewed_by,
 * reviewed_at). What approving does:
 *   propose_link         writes the Ticketmaster venue link (logged insert)
 *   propose_venue_match  pins that venue on the record (venue_matched_by =
 *                        "owner") and queues it for enrich, logged; later runs
 *                        keep the owner's match. Past events are only recorded.
 *   propose_venue        recorded only: venues are added through the signed
 *                        venue seed (AGENTS.md, venue verification)
 *   propose_category     recorded only: categories are added in the taxonomy
 *                        seed, a code change
 * Rejecting records the decision; rejected proposals aren't proposed again.
 */

export class ProposalError extends Error {}

export type Decision = "approved" | "rejected";

export async function decideProposal(db: DbExecutor, proposalId: string, decision: Decision, opts: { actor: string; note: string; now?: Date }) {
  const note = opts.note.trim();
  if (!opts.actor.startsWith("human:")) throw new ProposalError("only a person decides proposals");
  if (note.length < 3) throw new ProposalError("a short note is required");
  const now = opts.now ?? new Date();

  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(agentActions).where(eq(agentActions.id, proposalId)).for("update");
    if (!p || !p.action.startsWith("propose_")) throw new ProposalError("no such proposal");
    if (p.approvalStatus !== "pending") throw new ProposalError(`already ${p.approvalStatus}`);

    let effect = "recorded";
    if (decision === "approved") {
      const after = p.after as Record<string, unknown>;
      if (p.action === "propose_link") {
        await linkTicketmasterVenue(tx, {
          sourceId: String(after.sourceId),
          tmVenueId: String(after.tmVenueId),
          tmVenueName: (after.tmName as string | null) ?? null,
          venueSlug: String(after.venueSlug),
          actor: opts.actor,
          reason: `Owner approved link proposal: ${note}`,
        });
        effect = "link written";
      } else if (p.action === "propose_venue_match") {
        const [rec] = await tx.select().from(rawRecords).where(and(eq(rawRecords.id, String(after.rawRecordId)), eq(rawRecords.status, "needs_venue")));
        const startAt = (rec?.facts as { startAt?: string } | null)?.startAt;
        if (!rec) effect = "recorded (the record is no longer waiting for a venue)";
        else if (!startAt || new Date(startAt) < now) effect = "recorded (the event is already past)";
        else {
          const [updated] = await tx
            .update(rawRecords)
            .set({ status: "mapped", venueId: String(after.venueId), subSpace: (after.subSpace as string | null) ?? null, venueMatchedBy: "owner", locationKey: null, lastError: null })
            .where(eq(rawRecords.id, rec.id))
            .returning();
          await recordAction(tx, {
            actor: opts.actor, action: "update", entityType: "raw_record", entityId: rec.id,
            before: { status: rec.status, venueId: rec.venueId, venueMatchedBy: rec.venueMatchedBy },
            after: { status: updated.status, venueId: updated.venueId, venueMatchedBy: updated.venueMatchedBy },
            reason: `Owner approved venue match ${String(after.venueSlug)}: ${note}`,
          });
          effect = "venue pinned; the event is written on the next process run";
        }
      } else if (p.action === "propose_venue") {
        effect = "recorded: add the venue through the venue seed and sign-off";
      } else if (p.action === "propose_category") {
        effect = "recorded: add the category in the taxonomy seed";
      }
    }

    const [reviewed] = await tx
      .update(agentActions)
      .set({ approvalStatus: decision, reviewedBy: opts.actor, reviewedAt: now })
      .where(eq(agentActions.id, p.id))
      .returning();
    // The decision and its note, in the log (the proposal row has no note column).
    await recordAction(tx, {
      actor: opts.actor, action: "update", entityType: "proposal", entityId: p.id,
      before: { approvalStatus: "pending" }, after: { approvalStatus: decision, reviewedBy: opts.actor, effect },
      reason: `${decision === "approved" ? "Approved" : "Rejected"} ${p.action}: ${note}`,
    });
    return { proposal: reviewed, effect, note };
  });
}
