import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { COVERAGE_PLACE_NAMES } from "@/config/coverage";
import { publicBotIdentity } from "@/lib/bot-identity";
import { issueToken } from "@/lib/submissions/token";
import { SubmitForm } from "./form";

export const metadata: Metadata = {
  title: "Submit an event",
  description: "Tell 479 Guide about a public event in Benton or Washington County. Every submission is checked before it appears.",
};

const { contact: CONTACT } = publicBotIdentity();

/** Submit an event (step 10; owner, 2026-10-16): always reviewed, email only, deleted 30 days after the decision. */
export default async function SubmitPage() {
  await connection();
  const token = issueToken();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 leading-relaxed">
      <h1 className="font-display text-4xl font-extrabold text-brand">Submit an event</h1>
      <p className="mt-3">
        Know about a public event in Benton or Washington County? Tell us. We check every submission against the event&apos;s own
        page before it appears, and we list facts only: what, when, where, and a link back to you.
      </p>
      <p className="mt-2 text-sm text-muted">
        Post events often? A calendar on your own website (with an iCal or RSS feed) lets us pick them up automatically:{" "}
        <a className="underline" href={`mailto:${CONTACT}?subject=Our%20events%20calendar`}>
          send us its link
        </a>
        . How we use what you send: <Link className="underline" href="/privacy">Privacy</Link>.
      </p>
      <div className="mt-8">
        {token ? (
          <SubmitForm token={token} cities={COVERAGE_PLACE_NAMES} />
        ) : (
          <p>
            Submissions aren&apos;t open yet. Email <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> instead.
          </p>
        )}
      </div>
    </div>
  );
}
