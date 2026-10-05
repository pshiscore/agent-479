import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Admin | 479 Guide", robots: { index: false, follow: false } };

const NAV = [
  ["/admin", "Overview"],
  ["/admin/review", "Review"],
  ["/admin/proposals", "Proposals"],
  ["/admin/places", "Places"],
  ["/admin/dedup-review", "Dedup review"],
  ["/admin/agent-log", "Agent log"],
] as const;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 text-sm">
      <header className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <span className="text-base font-semibold">479 Guide admin</span>
        <nav className="flex gap-4">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
