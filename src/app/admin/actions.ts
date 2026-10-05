"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { rollbackAction } from "@/lib/actions/rollback";
import { requireAdmin } from "@/lib/admin/auth";
import { labelPair } from "@/lib/admin/dedup-review";
import { confirmSource, createPlace, hidePlace, linkVenue, parseFacts, type PlaceInput, publishPlace, removePlaceDescription, updatePlace, writePlaceDescription } from "@/lib/admin/places";
import { decideProposal } from "@/lib/admin/proposals";
import { changedFields, type EventFormValues, parseEventForm } from "@/lib/review/form";
import { addCheckedSource, approveProposal, createProposal, mergeProposal, proposalById, rejectProposal } from "@/lib/review/proposals";
import { getDb } from "@/lib/db/client";
import { generateStructured } from "@/lib/llm";
import type { Generate } from "@/lib/pipeline/enrich/types";

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

// ---- New in Town (places) ----

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

function placeInput(f: FormData): PlaceInput {
  return {
    name: str(f, "name"),
    placeType: str(f, "placeType") as PlaceInput["placeType"],
    kind: str(f, "kind") as PlaceInput["kind"],
    address: str(f, "address"),
    addressKind: (str(f, "addressKind") || "street") as PlaceInput["addressKind"],
    city: str(f, "city"),
    postalCode: str(f, "postalCode"),
    opened: str(f, "opened"),
    openedQualifier: str(f, "openedQualifier"),
    target: str(f, "target"),
    targetQualifier: str(f, "targetQualifier"),
    website: str(f, "website"),
    sourceUrl: str(f, "sourceUrl"),
    confirmed: str(f, "confirmed"),
    notes: str(f, "notes"),
    openToPublic: f.get("openToPublic") === "1" ? true : null,
  };
}

export async function addPlace(formData: FormData) {
  const actor = await requireAdmin();
  let target: string;
  try {
    const row = await createPlace(getDb(), placeInput(formData), { actor, ownerVerified: true, reason: "Added by the owner (owner-verified source)" });
    target = back(`/admin/places/${row.id}`, { msg: "Saved as a draft." });
  } catch (err) {
    target = back("/admin/places/new", { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}

/**
 * The place page's one form: saves the facts, records the page the owner
 * checked (with "open to the public" and any stated facts) when given, and
 * publishes on "Save and publish". Each step is its own logged action; if a
 * later step can't happen, the earlier ones still stand and the page says why.
 */
export async function editPlace(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) redirect(back("/admin/places", { error: "bad place id" }));
  const page = `/admin/places/${id.data}`;
  const done: string[] = [];
  let target: string;
  try {
    const db = getDb();
    const keep = formData.get("openToPublicCurrent");
    const current = keep === "true" ? true : keep === "false" ? false : null;
    await updatePlace(db, id.data, { ...placeInput(formData), sourceUrl: undefined, openToPublic: current }, { actor, reason: "Edited by the owner" });
    done.push("Saved.");

    const url = str(formData, "sourceUrl").trim();
    const confirmed = str(formData, "confirmed").trim();
    const openToPublic = formData.get("openToPublic") === "1";
    if (url || confirmed) {
      if (!url || !confirmed) throw new Error("to record what you checked, give both the page and what it says");
      await confirmSource(db, id.data, { actor, url, confirmed, openToPublic, facts: parseFacts(str(formData, "facts")) });
      done.push(`Recorded ${url} as checked by you${openToPublic ? ", open to the public" : ""}.`);
    } else if (openToPublic !== (current === true)) {
      throw new Error("open to the public is recorded with the page you checked (or your visit): fill in the page and what it says");
    }

    if (str(formData, "intent") === "publish") {
      const p = await publishPlace(db, id.data, { actor, note: confirmed || "Published by the owner" });
      done.push(`Published (${p.status === "open" ? "now open" : "opening soon"}).`);
    }
    target = back(page, { msg: done.join(" ") });
  } catch (err) {
    target = back(page, { ...(done.length ? { msg: done.join(" ") } : {}), error: `${done.length ? "Not finished" : "Not saved"}: ${message(err)}` });
  }
  redirect(target);
}

export async function confirmPlaceSource(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad place id");
    await confirmSource(getDb(), id.data, { actor, url: str(formData, "url"), confirmed: str(formData, "confirmed"), openToPublic: formData.get("openToPublic") === "1", facts: parseFacts(str(formData, "facts")) });
    target = back(`/admin/places/${id.data}`, { msg: "Source recorded as owner-verified." });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}

export async function publishPlaceAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad place id");
    const p = await publishPlace(getDb(), id.data, { actor, note: str(formData, "note") || "Published by the owner" });
    target = back(`/admin/places/${id.data}`, { msg: `Published (${p.status === "open" ? "now open" : "opening soon"}).` });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: message(err) });
  }
  redirect(target);
}

export async function hidePlaceAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad place id");
    await hidePlace(getDb(), id.data, { actor, reason: str(formData, "reason") });
    target = back(`/admin/places/${id.data}`, { msg: "Hidden." });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}

export async function linkPlaceVenue(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  const venueId = formData.get("venueId") ? uuid.safeParse(formData.get("venueId")) : null;
  let target: string;
  try {
    if (!id.success || (venueId && !venueId.success)) throw new Error("bad request");
    await linkVenue(getDb(), id.data, venueId?.data ?? null, { actor, reason: str(formData, "reason") || "Owner confirmed the match" });
    target = back(`/admin/places/${id.data}`, { msg: venueId ? "Venue linked." : "Venue link removed." });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}

export async function writePlaceDescriptionAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad place id");
    const db = getDb();
    const generate = ((req) => generateStructured(req, { db })) as Generate;
    const r = await writePlaceDescription(db, id.data, { requestedBy: actor, generate });
    const msg =
      r.status === "ok" ? "Description written." : r.status === "held" ? `Held after two drafts (${r.problem}). Nothing was saved.` : `No description: ${r.reason}.`;
    target = back(`/admin/places/${id.data}`, r.status === "ok" ? { msg } : { error: msg });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: `Not written: ${message(err)}` });
  }
  redirect(target);
}

export async function removePlaceDescriptionAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad place id");
    await removePlaceDescription(getDb(), id.data, { actor, reason: str(formData, "reason") || "Removed by the owner" });
    target = back(`/admin/places/${id.data}`, { msg: "Description removed." });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: `Not removed: ${message(err)}` });
  }
  redirect(target);
}

// ---- Review queue (festivals step 1) ----

const formValues = (f: FormData): EventFormValues => {
  const out: EventFormValues = {};
  for (const k of new Set(f.keys())) {
    const all = f.getAll(k).filter((v): v is string => typeof v === "string");
    out[k] = k === "tags" ? all : all[0];
  }
  return out;
};
const reviewBack = (params: Record<string, string>) => back("/admin/review", params);

/** "Add event": an owner-verified proposal; "Add and publish" approves it at once. Both steps are logged. */
export async function addEventAction(formData: FormData) {
  const actor = await requireAdmin();
  let target: string;
  try {
    const facts = parseEventForm(formValues(formData));
    const confirmed = str(formData, "confirmed").trim();
    const today = new Date().toISOString().slice(0, 10);
    const p = await createProposal(
      getDb(),
      { facts, sources: [{ url: facts.moreInfoUrl, checkedAt: today, verifiedBy: "owner", confirmed: confirmed || "Checked by the owner" }], origin: "owner_form", reasons: ["owner_draft"] },
      { actor },
    );
    if (str(formData, "intent") === "publish") {
      const { event } = await approveProposal(getDb(), p.id, { actor, note: "Added and published by the owner" });
      target = reviewBack({ msg: `Published "${event.title}".` });
    } else {
      target = reviewBack({ msg: `Saved "${facts.title}" for review.` });
    }
  } catch (err) {
    target = back("/admin/review/new", { error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}

export async function approveProposalAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad item id");
    const { event } = await approveProposal(getDb(), id.data, { actor, note: str(formData, "note") });
    target = reviewBack({ msg: `Approved and published "${event.title}".` });
  } catch (err) {
    target = reviewBack({ error: `Not approved: ${message(err)}` });
  }
  redirect(target);
}

export async function editApproveAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad item id");
    const p = await proposalById(getDb(), id.data);
    if (!p) throw new Error("no such item");
    const edits = changedFields(p.facts, parseEventForm(formValues(formData)));
    const { event } = await approveProposal(getDb(), id.data, { actor, note: str(formData, "note"), edits });
    target = reviewBack({ msg: `Approved "${event.title}" with ${Object.keys(edits).length} edit(s).` });
  } catch (err) {
    target = back(`/admin/review/${id.success ? id.data : ""}`, { error: `Not approved: ${message(err)}` });
  }
  redirect(target);
}

export async function rejectProposalAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad item id");
    await rejectProposal(getDb(), id.data, { actor, reason: str(formData, "reason") });
    target = reviewBack({ msg: "Rejected." });
  } catch (err) {
    target = reviewBack({ error: `Not rejected: ${message(err)}` });
  }
  redirect(target);
}

export async function mergeProposalAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  const eventId = uuid.safeParse(formData.get("eventId"));
  let target: string;
  try {
    if (!id.success || !eventId.success) throw new Error("choose the event to merge into");
    const { event } = await mergeProposal(getDb(), id.data, eventId.data, { actor, note: str(formData, "note") });
    target = reviewBack({ msg: `Merged into "${event.title}".` });
  } catch (err) {
    target = reviewBack({ error: `Not merged: ${message(err)}` });
  }
  redirect(target);
}

export async function addProposalSourceAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad item id");
    await addCheckedSource(getDb(), id.data, { actor, url: str(formData, "url"), confirmed: str(formData, "confirmed") });
    target = reviewBack({ msg: "Source recorded as owner-verified." });
  } catch (err) {
    target = reviewBack({ error: `Not saved: ${message(err)}` });
  }
  redirect(target);
}
