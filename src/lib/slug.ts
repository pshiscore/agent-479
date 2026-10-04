/** URL slugs: "Ziggy Marley" on 2026-10-16 → "ziggy-marley-2026-10-16". */
export function slugify(text: string, maxLength = 60): string {
  const base = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, maxLength).replace(/-+$/, "") || "event";
}
