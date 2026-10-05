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
}: {
  action: (f: FormData) => Promise<void>;
  values?: PlaceFormValues;
  cities: string[];
  submit: string;
  withSource: boolean;
  hidden?: Record<string, string>;
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
          <span className={hint}>Leave empty if the source states no opening date.</span>
        </label>
        <label className={field}>
          <span className={label}>Qualifier (optional)</span>
          <input name="openedQualifier" placeholder="soft opening, grand opening" defaultValue={values.openedQualifier ?? ""} className={input} />
        </label>
        <label className={field}>
          <span className={label}>Opening soon: target (optional)</span>
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
        <label className={`${field} sm:col-span-2`}>
          <span className={label}>Notes (internal)</span>
          <textarea name="notes" rows={2} defaultValue={values.notes ?? ""} className={input} />
        </label>
      </div>
      <div>
        <button className={button}>{submit}</button>
      </div>
    </form>
  );
}
