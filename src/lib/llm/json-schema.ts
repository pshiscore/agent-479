import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Converts a zod schema to the JSON Schema subset that strict structured
 * output modes accept: every object property required, no extra properties.
 * A field that may be absent must be `.nullable()`, never `.optional()`.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "throw" }) as JsonSchema;
  delete json.$schema;
  assertStrict(json, "$");
  return json;
}

function assertStrict(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertStrict(child, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as JsonSchema;

  if (obj.type === "object" || obj.properties) {
    const keys = Object.keys((obj.properties as JsonSchema | undefined) ?? {});
    const required = new Set((obj.required as string[] | undefined) ?? []);
    const optional = keys.filter((k) => !required.has(k));
    if (optional.length > 0) {
      throw new Error(
        `Strict schema at ${path}: optional field(s) ${optional.join(", ")}. ` +
          "Use .nullable() instead of .optional().",
      );
    }
    if (obj.additionalProperties !== false) {
      throw new Error(`Strict schema at ${path}: objects must not allow extra properties.`);
    }
  }
  for (const [key, child] of Object.entries(obj)) assertStrict(child, `${path}.${key}`);
}
