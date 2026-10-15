/**
 * JSON value types shared by every ReplayKit schema.
 *
 * Tool arguments, tool responses, and metadata are arbitrary JSON. Keeping a
 * single recursive schema here means every other schema validates them the
 * same way and the generated JSON Schema has one `JsonValue` definition.
 */
import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(JsonValueSchema),
      z.record(z.string(), JsonValueSchema),
    ]),
  )
  .meta({ id: "JsonValue", description: "Any JSON value." });

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export function isJsonObject(value: JsonValue | undefined | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
