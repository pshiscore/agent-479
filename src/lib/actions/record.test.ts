import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { actionInputSchema, agentActor, humanActor, type ActionInput } from "./record";

const update: ActionInput = {
  actor: agentActor("process"),
  job: "process",
  action: "update",
  entityType: "event",
  entityId: randomUUID(),
  before: { title: "Jazz Nite" },
  after: { title: "Jazz Night" },
  reason: "Source corrected the title",
};

const proposal: ActionInput = {
  actor: agentActor("maintenance"),
  action: "propose_venue",
  entityType: "venue",
  after: { name: "Butterscotch Bakery & Bar", city: "Bentonville" },
  approvalStatus: "pending",
  dedupeKey: "butterscotch bakery bar|bentonville",
  reason: "Unmatched location seen in 3 events",
};

const errorsFor = (input: ActionInput) => {
  const r = actionInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("actionInputSchema", () => {
  it("accepts a well-formed update and proposal", () => {
    expect(errorsFor(update)).toEqual([]);
    expect(errorsFor(proposal)).toEqual([]);
  });

  it("requires actor to be agent:* or human:*", () => {
    expect(errorsFor({ ...update, actor: "robot" })).toHaveLength(1);
    expect(errorsFor({ ...update, actor: humanActor("admin") })).toEqual([]);
  });

  it("requires a reason", () => {
    expect(errorsFor({ ...update, reason: "  " })).toContain("reason is required");
  });

  it.each(["update", "merge", "unmerge", "disable", "enable", "recheck_correct"] as const)(
    "%s needs before and after to be reversible",
    (action) => {
      expect(errorsFor({ ...update, action, before: null })).toContain(
        `${action} needs both before and after so it can be rolled back`,
      );
    },
  );

  it("insert needs after and no before", () => {
    expect(errorsFor({ ...update, action: "insert", before: null })).toEqual([]);
    expect(errorsFor({ ...update, action: "insert" })).toContain("insert must not have before");
  });

  it("only proposals carry an approval status, and they must be pending with a dedupe key", () => {
    expect(errorsFor({ ...update, approvalStatus: "pending" })).toContain(
      "only propose_venue is created with an approval status",
    );
    expect(errorsFor({ ...proposal, approvalStatus: "approved" })).toContain(
      "propose_venue must be created as pending",
    );
    expect(errorsFor({ ...proposal, dedupeKey: null })).toContain("propose_venue needs a dedupeKey");
    expect(errorsFor({ ...proposal, entityId: randomUUID() })).toContain(
      "propose_venue has no entityId until approved",
    );
  });

  it("rollback must reference the action it reverts", () => {
    expect(errorsFor({ ...update, action: "rollback" })).toContain("rollback needs revertsActionId");
  });

  it("model belongs to agent actions, and an llm call needs its model", () => {
    expect(errorsFor({ ...update, actor: humanActor("admin"), model: "gpt-6-luna" })).toContain(
      "model is only set on agent actions",
    );
    expect(errorsFor({ ...update, llmCallId: randomUUID() })).toContain(
      "llmCallId needs the model name too",
    );
  });

  it("bounds confidence to 0..1", () => {
    expect(errorsFor({ ...update, confidence: 1.2 })).toHaveLength(1);
    expect(errorsFor({ ...update, confidence: 0.85 })).toEqual([]);
  });
});
