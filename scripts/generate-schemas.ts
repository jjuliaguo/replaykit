import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CallLogSchema, ReplayFixtureSchema } from "../src/shared/types.js";

mkdirSync("schemas", { recursive: true });
for (const [file, schema] of [
  ["fixture.schema.json", ReplayFixtureSchema],
  ["call-log.schema.json", CallLogSchema],
] as const) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  writeFileSync(`schemas/${file}`, JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote schemas/${file}`);
}
