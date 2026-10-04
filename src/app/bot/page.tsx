import type { Metadata } from "next";
import { BOT_NAME, BOT_VERSION, publicBotIdentity } from "@/lib/bot-identity";
import { SOURCE_SEEDS } from "@/lib/sources/seed-data";

export const metadata: Metadata = {
  title: "Agent479Bot | 479 Guide",
  description: "What Agent479Bot fetches for 479 Guide, how often, and how to opt out.",
};

// Never a personal address: publicBotIdentity falls back to bot@479.guide.
const { site: SITE, contact: CONTACT } = publicBotIdentity();

const hours = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`);
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

// The sources we read (or will, once each passes its test fetch). Sources
// awaiting permission aren't listed: we don't fetch them at all.
const READ = SOURCE_SEEDS.filter((s) => s.launch);

export default function BotPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 leading-relaxed">
      <h1 className="text-3xl font-semibold tracking-tight">Agent479Bot</h1>
      <p className="mt-4">
        Agent479Bot collects public event listings for <a className="underline" href={SITE}>479 Guide</a>, a free calendar
        of things to do in Northwest Arkansas. It identifies itself with this user agent:
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
        {`${BOT_NAME}/${BOT_VERSION} (+${SITE}/bot; ${CONTACT})`}
      </pre>

      <h2 className="mt-10 text-xl font-semibold">What it fetches</h2>
      <p className="mt-3">
        Public calendar feeds (iCal or RSS) and public APIs, and occasionally a single event&apos;s own page on the same
        site when a feed gives only a city for the event&apos;s location. We keep the facts (title, date, time, place,
        price, and a link back to you), never your descriptions or images.
      </p>
      <ul className="mt-3 list-disc pl-6">
        {READ.map((s) => (
          <li key={s.slug}>
            {s.name} ({host(s.baseUrl)}): about every {hours(s.fetchIntervalMinutes)}
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-xl font-semibold">How it behaves</h2>
      <ul className="mt-3 list-disc pl-6">
        <li>It reads robots.txt before every site and follows it, including Crawl-delay.</li>
        <li>It waits at least 3 seconds between requests to the same site.</li>
        <li>
          If a site refuses it (an error such as 401, 403, or 429, a bot challenge, or a robots.txt rule), it stops and
          doesn&apos;t retry that site until a person reviews it. It never works around a block.
        </li>
        <li>It doesn&apos;t fetch sites whose terms forbid automated access unless the owner has given us permission.</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Opting out</h2>
      <p className="mt-3">Either of these works, and you don&apos;t need to give a reason:</p>
      <ul className="mt-3 list-disc pl-6">
        <li>
          Add this to your robots.txt. The bot reads it on its next visit and stops:
          <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-900">{`User-agent: ${BOT_NAME}\nDisallow: /`}</pre>
        </li>
        <li>
          Email <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> with your site&apos;s address. We turn
          off that source by hand, record the request, and reply to confirm. We only turn it back on with your
          written permission.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Contact</h2>
      <p className="mt-3">
        Questions, corrections, or a feed you&apos;d like us to use instead: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </main>
  );
}
