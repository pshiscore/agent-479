import type { SourceRow } from "@/lib/sources/types";
import { type Facts, factsSchema, MapError } from "./facts";
import { mapIcs } from "./ics";
import { mapJsonLd } from "./jsonld";
import { mapTicketmaster } from "./ticketmaster";

export { type Facts, factsSchema, MapError, SkipRecord } from "./facts";

/** Maps one raw payload to validated facts. Throws MapError or SkipRecord. */
export function mapRecord(payload: Record<string, unknown>, source: Pick<SourceRow, "baseUrl" | "config">): Facts {
  let facts: Facts;
  switch (payload.format) {
    case "ics":
      facts = mapIcs(payload as unknown as Parameters<typeof mapIcs>[0], source);
      break;
    case "jsonld":
      facts = mapJsonLd(payload as unknown as Parameters<typeof mapJsonLd>[0]);
      break;
    case "ticketmaster":
      facts = mapTicketmaster(payload as unknown as Parameters<typeof mapTicketmaster>[0]);
      break;
    default:
      throw new MapError(`no mapper for payload format ${JSON.stringify(payload.format)}`);
  }
  const parsed = factsSchema.safeParse(facts);
  if (!parsed.success) throw new MapError(`mapped facts are invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}
