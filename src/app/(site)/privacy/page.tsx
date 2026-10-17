import type { Metadata } from "next";
import { connection } from "next/server";
import { publicBotIdentity } from "@/lib/bot-identity";
import { googleWidgetEnabled } from "@/lib/google/places";
import { SUBMITTER_EMAIL_DAYS } from "@/lib/submissions/purge";
import { mapBaseUrl } from "@/config/map";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What 479 Guide collects (almost nothing: an email only if you submit an event), who hosts it, and what loads from Google and when.",
};

const { contact: CONTACT } = publicBotIdentity();

/**
 * Privacy (owner, 2026-10-06). Every sentence must be literally true; update
 * this page before any change it describes (docs/PREDEPLOY_CHECKLIST.md,
 * Privacy). A guard test fails if analytics packages appear in the code.
 */
export default async function PrivacyPage() {
  await connection();
  // The Google paragraph shows only while the widget it describes is switched on.
  const googleWidget = googleWidgetEnabled();
  // The map sentence shows only while the venues map is switched on (its files are hosted).
  const venuesMap = mapBaseUrl() !== "";
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 leading-relaxed">
      <h1 className="font-display text-4xl font-extrabold text-brand">Privacy</h1>
      <p className="mt-2 text-sm text-muted">Last updated October 17, 2026.</p>

      <h2 className="mt-8 text-xl font-bold">What we collect from you</h2>
      <p className="mt-2">
        Nothing, unless you submit an event (below). 479 Guide has no accounts, sign-ups, or comments. We don&apos;t run
        analytics or advertising, our pages set no cookies, and they load only our own scripts and fonts
        {googleWidget ? ", unless you ask for Google ratings (below)" : ""}.
      </p>

      <h2 className="mt-8 text-xl font-bold">If you submit an event</h2>
      <p className="mt-2">
        The <a className="underline" href="/submit">Submit an event</a> form sends us what you type: the event&apos;s details and
        link, who&apos;s putting it on and a note if you add them, and your email address.
      </p>
      <ul className="mt-2 list-disc pl-6">
        <li>
          We use your email only to ask about the event you sent, and to limit how many events one address can send in a
          day. We delete it, along with your note, {SUBMITTER_EMAIL_DAYS} days after we approve or decline the event.
        </li>
        <li>
          If we approve the event, its facts (what, when, where, and your link) appear on the site after we&apos;ve checked them.
          Either way we keep the event details you sent as our record of the decision.
        </li>
        <li>
          To keep out spam, the form uses a hidden field and checks how long it took to fill in. We don&apos;t use a CAPTCHA or any
          outside service, and we don&apos;t record your IP address (our host&apos;s standard logs, below, still apply).
        </li>
        <li>Our log of changes records that a submission arrived, never your email address.</li>
      </ul>

      <h2 className="mt-8 text-xl font-bold">What stays in your browser</h2>
      <p className="mt-2">
        If you pick Light or Dark, that choice is saved in your browser&apos;s local storage on your device. It never reaches
        us. While the site is in private preview, your browser remembers the preview login.
      </p>

      <h2 className="mt-8 text-xl font-bold">Hosting and email</h2>
      <p className="mt-2">
        The site is served by Vercel. Like any web host, Vercel keeps standard request logs (for example your IP address,
        the page you asked for, your browser type, and the time) to run and protect the service. Cloudflare runs our
        domain&apos;s DNS and our email routing
        {venuesMap ? ", and stores and serves the venues map's files (map tiles, fonts, and icons) from our own map address" : ""}, and keeps
        its own standard logs of those services.
      </p>
      <p className="mt-2">
        If you email <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>, Cloudflare routes your message to the
        person who runs 479 Guide. We use it only to reply and to act on what you ask, such as a correction or an opt-out.
      </p>

      {googleWidget && (
        <>
          <h2 className="mt-8 text-xl font-bold">Google ratings and reviews</h2>
          <p className="mt-2">
            On New in Town place pages, tapping &quot;Show Google ratings and reviews&quot; loads content from Google into the
            page. Nothing from Google loads before you tap. Once you do, Google&apos;s{" "}
            <a className="underline" href="https://policies.google.com/privacy" rel="noopener" target="_blank">
              Privacy Policy
            </a>{" "}
            applies to what Google receives and sets.
          </p>
        </>
      )}

      <h2 className="mt-8 text-xl font-bold">Links to other sites</h2>
      <p className="mt-2">
        Event, ticket, website, Directions, and Maps links take you to other sites, which have their own privacy policies.
        Following a link sends them only what your browser normally sends.
      </p>

      <h2 className="mt-8 text-xl font-bold">Questions</h2>
      <p className="mt-2">
        Email <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. We update this page before anything it
        describes changes.
      </p>
    </div>
  );
}
