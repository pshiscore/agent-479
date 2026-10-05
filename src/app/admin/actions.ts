"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { rollbackAction } from "@/lib/actions/rollback";
import { requireAdmin } from "@/lib/admin/auth";
import { labelPair } from "@/lib/admin/dedup-review";
import { confirmSource, createPlace, hidePlace, linkVenue, parseFacts, type PlaceInput, publishPlace, removePlaceDescription, updatePlace, writePlaceDescription } from "@/lib/admin/places";
import { decideProposal } from "@/lib/admin/proposals";
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

export async function editPlace(formData: FormData) {
  const actor = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  let target: string;
  try {
    if (!id.success) throw new Error("bad place id");
    const before = placeInput(formData);
    // The edit form carries no source fields; keep openToPublic as it is (confirmed separately).
    const keep = formData.get("openToPublicCurrent");
    await updatePlace(getDb(), id.data, { ...before, sourceUrl: undefined, openToPublic: keep === "true" ? true : keep === "false" ? false : null }, { actor, reason: "Edited by the owner" });
    target = back(`/admin/places/${id.data}`, { msg: "Saved." });
  } catch (err) {
    target = back(`/admin/places/${id.success ? id.data : ""}`, { error: `Not saved: ${message(err)}` });
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
