import { PLACE_KIND_LABELS, PLACE_TYPE_LABELS } from "@/lib/places/format";
import { button, input } from "../ui";

/** The place form (add and edit). Dates: YYYY-MM-DD for a day, YYYY-MM when the source states only a month. */

export interface PlaceFormValues {
  name?: string;
  placeType?: string;
  kind?: string;
  address?: string;
  addressKind?: string;
  city?: string;
  postalCode?: string | null;
  opened?: string;
  openedQualifier?: string | null;
  target?: string;
  targetQualifier?: string | null;
  website?: string | null;
  sourceUrl?: string;
  notes?: string | null;
  // Edit mode: what the owner checked (prefilled), recorded with the save.
  openToPublic?: boolean | null;
}

const field = "grid gap-1";
const label = "font-semibold";
const hint = "text-xs text-zinc-500";

export function PlaceForm({
  action,
  values = {},
  cities,
  submit,
  withSource,
  hidden = {},
  verify,
}: {
  action: (f: FormData) => Promise<void>;
  values?: PlaceFormValues;
  cities: string[];
  submit: string;
  withSource: boolean;
  hidden?: Record<string, string>;
  /** Edit mode: record a checked source with the save, and offer "Save and publish". */
  verify?: { canPublish: boolean; leads?: string[]; openingSoon?: boolean };
}) {
  return (
    <form action={action} className="grid max-w-3xl gap-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          <span className={label}>Name</span>
          <input name="name" required minLength={2} defaultValue={values.name} className={input} />
        </label>
        <label className={field}>
          <span className={label}>Type</span>
          <select name="placeType" required defaultValue={values.placeType ?? "restaurant"} className={input}>
            {Object.entries(PLACE_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span className={label}>Kind</span>
          <select name="kind" required defaultValue={values.kind ?? "new"} className={input}>
            {Object.entries(PLACE_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <span className={hint}>New location: an existing business in a new spot. Moved: a relocation.</span>
        </label>
        <label className={field}>
          <span className={label}>City</span>
          <input name="city" required list="place-cities" defaultValue={values.city} className={input} />
          <datalist id="place-cities">
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className={`${field} sm:col-span-2`}>
          <span className={label}>Address</span>
          <input name="address" required defaultValue={values.address} className={input} />
          <span className={hint}>A street address, an intersection (&quot;W McMillan Dr at W Wedington Dr&quot;), or for food trucks the stated home base.</span>
        </label>
        <label className={field}>
          <span className={label}>Address is</span>
          <select name="addressKind" defaultValue={values.addressKind ?? "street"} className={input}>
            <option value="street">A street address</option>
            <option value="intersection">An intersection (street number unconfirmed)</option>
          </select>
          <span className={hint}>Food trucks are saved as &quot;Based at&quot; automatically.</span>
        </label>
        <label className={field}>
          <span className={label}>ZIP (optional)</span>
          <input name="postalCode" pattern="\d{5}" defaultValue={values.postalCode ?? ""} className={input} />
        </label>
        <label className={field}>
          <span className={label}>Opened (as the source states it)</span>
          <input name="opened" placeholder="2026-08-10 or 2026-06" pattern="\d{4}-\d{2}(-\d{2})?" defaultValue={values.opened} className={input} />
          <span className={hint}>The date it opened, as stated. Leave empty if no source states one (then use the target below only if it hasn&apos;t opened yet).</span>
        </label>
        <label className={field}>
          <span className={label}>Qualifier (optional)</span>
          <input name="openedQualifier" placeholder="soft opening, grand opening" defaultValue={values.openedQualifier ?? ""} className={input} />
        </label>
        <label className={field}>
          <span className={label}>Not open yet: target date (optional)</span>
          <input name="target" placeholder="2026-11 or 2026-11-20" pattern="\d{4}-\d{2}(-\d{2})?" defaultValue={values.target} className={input} />
        </label>
        <label className={field}>
          <span className={label}>Target qualifier (optional)</span>
          <input name="targetQualifier" defaultValue={values.targetQualifier ?? ""} className={input} />
        </label>
        <label className={`${field} sm:col-span-2`}>
          <span className={label}>Official website (optional)</span>
          <input name="website" type="url" defaultValue={values.website ?? ""} className={input} />
        </label>
        {withSource && (
          <>
            <label className={`${field} sm:col-span-2`}>
              <span className={label}>Source URL</span>
              <input name="sourceUrl" type="url" required defaultValue={values.sourceUrl} className={input} />
              <span className={hint}>The page that states the opening. You checked it in your browser, so it&apos;s recorded as owner-verified.</span>
            </label>
            <label className={`${field} sm:col-span-2`}>
              <span className={label}>What you saw there</span>
              <input name="confirmed" placeholder="Article states it opened Aug 10, 2026 at 1410 SE 8th St" className={input} />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" name="openToPublic" value="1" />
              <span className={label}>Open to the public</span>
              <span className={hint}>(required before publishing)</span>
            </label>
          </>
        )}
        {verify && (
          <fieldset className="grid gap-3 rounded border border-zinc-300 p-3 sm:col-span-2 dark:border-zinc-700">
            <legend className="px-1 font-semibold">What you checked (optional with each save)</legend>
            <label className={field}>
              <span className={label}>Page you checked in your browser</span>
              <input name="sourceUrl" type="url" defaultValue={values.sourceUrl} placeholder="Official site, Instagram or Facebook post, article" className={input} />
              <span className={hint}>Recorded as owner-verified with today&apos;s date. Instagram and Facebook are fine when you read them yourself. Google reviews aren&apos;t a source.</span>
              {verify.leads && verify.leads.length > 0 && (
                <span className={hint}>
                  Research leads (not checked yet):{" "}
                  {verify.leads.map((u, i) => (
                    <span key={u}>
                      {i > 0 ? ", " : ""}
                      <a href={u} target="_blank" rel="noreferrer" className="underline">
                        {u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
                      </a>
                    </span>
                  ))}
                </span>
              )}
            </label>
            <label className={field}>
              <span className={label}>What it says</span>
              <input name="confirmed" placeholder="e.g. Grand opening Aug 18, 2026. Or: I visited Oct 2; open to the public" className={input} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="openToPublic" value="1" defaultChecked={values.openToPublic === true} />
              <span className={label}>Open to the public</span>
              <span className={hint}>(required before publishing; your own visit counts)</span>
            </label>
            <label className={field}>
              <span className={label}>Other facts this page states (optional, one per line)</span>
              <textarea name="facts" rows={2} placeholder="e.g. serves breakfast and lunch" className={input} />
              <span className={hint}>In your own words; used for the description.</span>
            </label>
          </fieldset>
        )}
        <label className={`${field} sm:col-span-2`}>
          <span className={label}>Notes (internal)</span>
          <textarea name="notes" rows={2} defaultValue={values.notes ?? ""} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button name="intent" value="save" className={verify ? "rounded border border-zinc-400 px-3 py-1" : button}>
          {submit}
        </button>
        {verify && (verify.canPublish || verify.openingSoon) && (
          <button name="intent" value="publish" className={button}>
            {verify.openingSoon ? "Save and mark open" : "Save and publish"}
          </button>
        )}
      </div>
    </form>
  );
}
