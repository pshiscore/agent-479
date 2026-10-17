"use client";

import { useActionState } from "react";
import { submitEventAction, type SubmitState } from "./actions";

const field = "w-full rounded-md border border-line bg-background px-3 py-2 text-base";
const label = "grid gap-1 text-sm font-semibold";

export function SubmitForm({ token, cities }: { token: string; cities: readonly string[] }) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitEventAction, { result: null, values: {} });
  const v = state.values;
  const err = state.result && !state.result.ok ? state.result.fields ?? {} : {};
  const hint = (k: string) => (err[k] ? <span className="text-sm font-normal text-red-700 dark:text-red-400">Needs {err[k]}.</span> : null);

  if (state.result?.ok) {
    return (
      <div className="rounded-md border border-line bg-tint p-4" role="status">
        <p className="font-semibold">Thanks! We got it.</p>
        <p className="mt-1">We check every event against its own page before it appears. If we have a question, we&apos;ll email you.</p>
      </div>
    );
  }
  // A new key after each try re-renders the inputs with what was typed.
  return (
    <form action={action} key={JSON.stringify(v)} className="grid gap-5">
      {state.result && !state.result.ok && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
          {state.result.error}
        </p>
      )}
      <input type="hidden" name="token" value={token} />
      {/* Left empty by people; bots fill it in. Hidden from screen readers and the keyboard. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <label className={label}>
        Event name {hint("title")}
        <input name="title" required maxLength={200} defaultValue={v.title} className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Date {hint("date")}
          <input type="date" name="date" required defaultValue={v.date} className={field} />
        </label>
        <label className={label}>
          Start time <span className="font-normal text-muted">(leave empty if it runs all day)</span> {hint("startTime")}
          <input type="time" name="startTime" defaultValue={v.startTime} className={field} />
        </label>
        <label className={label}>
          End date <span className="font-normal text-muted">(if it runs more than one day)</span> {hint("endDate")}
          <input type="date" name="endDate" defaultValue={v.endDate} className={field} />
        </label>
        <label className={label}>
          End time {hint("endTime")}
          <input type="time" name="endTime" defaultValue={v.endTime} className={field} />
        </label>
      </div>
      <label className={label}>
        Where <span className="font-normal text-muted">(the place&apos;s name and street address)</span> {hint("place")}
        <input name="place" required maxLength={300} defaultValue={v.place} className={field} />
      </label>
      <label className={label}>
        City or town {hint("city")}
        <input name="city" required list="submit-cities" maxLength={80} defaultValue={v.city} className={field} />
        <datalist id="submit-cities">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className={label}>
        Link to the event <span className="font-normal text-muted">(its page on your website, a ticket page, or a public event post)</span> {hint("eventUrl")}
        <input type="url" name="eventUrl" required placeholder="https://" defaultValue={v.eventUrl} className={field} />
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Is it free?</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["yes", "Yes, free"],
              ["no", "No, it costs something"],
              ["unknown", "Not sure"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="free" value={value} defaultChecked={(v.free ?? "unknown") === value} />
              {text}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={label}>
        Who&apos;s putting it on <span className="font-normal text-muted">(optional)</span>
        <input name="organizer" maxLength={200} defaultValue={v.organizer} className={field} />
      </label>
      <label className={label}>
        Your email {hint("email")}
        <span className="font-normal text-muted">Only to ask about this event. We delete it 30 days after we decide.</span>
        <input type="email" name="email" required maxLength={254} autoComplete="email" defaultValue={v.email} className={field} />
      </label>
      <label className={label}>
        Anything we should know? <span className="font-normal text-muted">(optional, just for us; not published)</span>
        <textarea name="note" rows={3} maxLength={500} defaultValue={v.note} className={field} />
      </label>
      <div>
        <button disabled={pending} className="rounded-md bg-brand px-5 py-2.5 font-semibold text-brand-ink disabled:opacity-60">
          {pending ? "Sending…" : "Send for review"}
        </button>
      </div>
    </form>
  );
}
