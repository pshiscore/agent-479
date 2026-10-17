"use server";

import { getDb } from "@/lib/db/client";
import { submitEvent, type SubmitResult } from "@/lib/submissions/submit";

/**
 * The one public Server Action (step 10). No login: anyone may submit. It
 * takes only the form's own fields, validates everything again on the
 * server, and can only create a review item; nothing publishes from here.
 */

const FIELDS = ["title", "date", "startTime", "endDate", "endTime", "place", "city", "eventUrl", "free", "organizer", "email", "note", "website", "token"] as const;

export interface SubmitState {
  result: SubmitResult | null;
  values: Record<string, string>;
}

export async function submitEventAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const raw: Record<string, string> = {};
  for (const k of FIELDS) {
    const v = formData.get(k);
    raw[k] = typeof v === "string" ? v.slice(0, 2000) : "";
  }
  try {
    const result = await submitEvent(getDb(), raw);
    // Typed values come back so the form keeps them; never the hidden field or the token.
    const values = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "website" && k !== "token"));
    return { result, values: result.ok ? {} : values };
  } catch {
    return { result: { ok: false, error: "Something went wrong on our side. Please try again, or email us." }, values: raw };
  }
}
