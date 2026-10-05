import type { EventFormOptions } from "@/lib/review/options";
import { input } from "../ui";

/** Event fields shared by "Add event" and "Edit and approve". Times are Chicago time. */

const field = "grid gap-1";
const label = "font-semibold";
const hint = "text-xs text-zinc-500";

type Values = Record<string, string | string[]>;
const val = (v: Values, k: string) => {
  const x = v[k];
  return Array.isArray(x) ? (x[0] ?? "") : (x ?? "");
};

export function EventFields({ options, values = {} }: { options: EventFormOptions; values?: Values }) {
  const picked = new Set(Array.isArray(values.tags) ? values.tags : []);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={`${field} sm:col-span-2`}>
        <span className={label}>Title (as published)</span>
        <input name="title" required minLength={2} defaultValue={val(values, "title")} className={input} />
      </label>
      <label className={field}>
        <span className={label}>Starts</span>
        <span className="flex gap-2">
          <input type="date" name="startDate" required defaultValue={val(values, "startDate")} className={input} />
          <input type="time" name="startTime" defaultValue={val(values, "startTime")} className={input} />
        </span>
        <span className={hint}>Leave the time empty for an all-day event.</span>
      </label>
      <label className={field}>
        <span className={label}>Ends (optional)</span>
        <span className="flex gap-2">
          <input type="date" name="endDate" defaultValue={val(values, "endDate")} className={input} />
          <input type="time" name="endTime" defaultValue={val(values, "endTime")} className={input} />
        </span>
        <span className={hint}>A multi-day festival: its last day (and closing time).</span>
      </label>
      <label className={field}>
        <span className={label}>Venue</span>
        <select name="venueId" required defaultValue={val(values, "venueId")} className={input}>
          <option value="">Choose a venue</option>
          {options.venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}, {v.city}
            </option>
          ))}
        </select>
        <span className={hint}>Not listed? A new venue goes through the venue process first.</span>
      </label>
      <label className={field}>
        <span className={label}>Room or area (optional)</span>
        <input name="subSpace" defaultValue={val(values, "subSpace")} placeholder="e.g. Upper Ramble lawn" className={input} />
      </label>
      <label className={field}>
        <span className={label}>Category</span>
        <select name="categoryId" required defaultValue={val(values, "categoryId")} className={input}>
          <option value="">Choose a category</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className={field}>
        <span className={label}>Tags (optional)</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {options.tags.map((t) => (
            <label key={t.slug} className="flex items-center gap-1.5">
              <input type="checkbox" name="tags" value={t.slug} defaultChecked={picked.has(t.slug)} /> {t.name}
            </label>
          ))}
        </span>
      </fieldset>
      <fieldset className={`${field} sm:col-span-2`}>
        <span className={label}>Stated on the page</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="free" value="1" defaultChecked={val(values, "free") === "1"} /> Free (the page says so)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="registration" value="1" defaultChecked={val(values, "registration") === "1"} /> Registration required
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="spanish" value="1" defaultChecked={val(values, "spanish") === "1"} /> Conducted in Spanish
          </label>
        </span>
        <span className={hint}>Free, 21+, Registration required, Ticketed, and En español tags are set from these facts.</span>
      </fieldset>
      <label className={field}>
        <span className={label}>Price (optional)</span>
        <span className="flex items-center gap-2">
          $<input type="number" name="priceMin" min={0} step="0.01" defaultValue={val(values, "priceMin")} className={`${input} w-24`} /> to $
          <input type="number" name="priceMax" min={0} step="0.01" defaultValue={val(values, "priceMax")} className={`${input} w-24`} />
        </span>
      </label>
      <label className={field}>
        <span className={label}>Ages (optional)</span>
        <span className="flex items-center gap-2">
          <input type="number" name="ageMin" min={0} max={120} defaultValue={val(values, "ageMin")} className={`${input} w-20`} /> to
          <input type="number" name="ageMax" min={0} max={120} defaultValue={val(values, "ageMax")} className={`${input} w-20`} />
        </span>
        <span className={hint}>21 and up adds the 21+ tag.</span>
      </label>
      <label className={field}>
        <span className={label}>Official page (More info)</span>
        <input type="url" name="moreInfoUrl" required defaultValue={val(values, "moreInfoUrl")} className={input} />
      </label>
      <label className={field}>
        <span className={label}>Ticket link (optional)</span>
        <input type="url" name="ticketUrl" defaultValue={val(values, "ticketUrl")} className={input} />
      </label>
    </div>
  );
}
