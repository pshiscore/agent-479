const NAMED: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", raquo: "»", laquo: "«", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", lt: "<", gt: ">" };

/** HTML entities in attribute values, titles, and JSON-LD strings: named, decimal (&#038;), and hex. */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (NAMED[e.toLowerCase()] ?? m),
  );
