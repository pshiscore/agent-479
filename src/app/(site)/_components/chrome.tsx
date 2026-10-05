import Link from "next/link";
import { ThemeSwitch } from "./theme-switch";

/** Site header and footer (docs/product/front-page.md, A2). */

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="479 Guide, home">
      <span className="rounded-md bg-brand px-2 py-0.5 font-logo text-2xl leading-tight tracking-wide text-brand-ink">479</span>
      <span className="font-display text-2xl font-extrabold">Guide</span>
    </Link>
  );
}

const NAV = [
  ["/#this-weekend", "This weekend"],
  ["/?when=week#this-weekend", "This week"],
  ["/upcoming", "Upcoming"],
  ["/venues", "Venues"],
  ["/#lists", "Lists"],
] as const;

export function Header() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4">
        <Logo />
        <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-accent">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 bg-tint">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:justify-between">
        <p className="max-w-md text-muted">
          479 Guide lists events from public sources across Northwest Arkansas. Summaries are generated from those listings and link to the original.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 font-semibold underline underline-offset-4">
          <Link href="/bot">About Agent 479</Link>
          <a href="mailto:bot@479.guide?subject=Issue%20on%20479%20Guide">Report an issue</a>
          <Link href="/bot">For site owners</Link>
        </nav>
      </div>
    </footer>
  );
}

export function SectionTitle({ id, children, tone = "brand" }: { id?: string; children: React.ReactNode; tone?: "brand" | "accent" }) {
  return (
    <h2 id={id} className={`inline-block rounded-md px-3 py-1 font-display text-2xl font-extrabold text-white ${tone === "brand" ? "bg-brand" : "bg-accent text-accent-ink"} scroll-mt-6`}>
      {children}
    </h2>
  );
}
