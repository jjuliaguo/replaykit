/**
 * replaykit extract: turn call logs into regression-test fixtures.
 *
 *   npm run extract -- examples/call-logs/booking-false-confirmation.json
 *   npm run extract -- examples/call-logs --out fixtures/generated
 *   npm run extract -- log.json --dry-run --min-confidence high
 *
 * Exit codes: 0 = ran (with or without findings), 1 = bad input or usage.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { extract, type ExtractResult } from "./extract.js";
import { INPUT_FORMATS, type InputFormat } from "./adapters/index.js";

const USAGE = `Usage: npm run extract -- <log.json | directory>... [options]

Options:
  --out <dir>              where to write fixtures (default: fixtures/generated)
  --format <fmt>           auto | calllog | openai-chat | bland | retell | vapi | messages | transcript-text (default: auto)
  --min-confidence <lvl>   medium | high (default: medium)
  --extracted-at <iso>     fixed timestamp, for reproducible output
  --dry-run                analyze and print, but write nothing
  --json                   print results as JSON instead of text
  --help`;

async function expandInputs(inputs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const input of inputs) {
    const info = await stat(input);
    if (info.isDirectory()) {
      const entries = (await readdir(input)).filter((f) => f.endsWith(".json")).sort();
      files.push(...entries.map((f) => path.join(input, f)));
    } else files.push(input);
  }
  return files;
}

function describe(file: string, result: ExtractResult, written: string | null): string {
  const lines = [`${file}`];
  lines.push(`  log: ${result.callLog.id} (${result.callLog.provider}, ${result.callLog.kind}), ${result.callLog.events.length} events`);
  if (result.findings.length === 0) {
    lines.push("  no failure detected; no fixture generated");
    return lines.join("\n");
  }
  for (const f of result.findings) {
    lines.push(`  [${f.confidence}] ${f.type}: ${f.summary}`);
  }
  if (result.fixture) {
    lines.push(`  fixture: ${result.fixture.id} with ${result.fixture.expectations.length} expectation(s): ${result.fixture.expectations.map((e) => e.id).join(", ")}`);
  }
  lines.push(written ? `  wrote ${written}` : "  (dry run, nothing written)");
  return lines.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string", default: "fixtures/generated" },
        format: { type: "string", default: "auto" },
        "min-confidence": { type: "string", default: "medium" },
        "extracted-at": { type: "string" },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    console.error((error as Error).message);
    console.error(USAGE);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (values.format !== "auto" && !INPUT_FORMATS.includes(values.format)) {
    console.error(`unknown --format "${values.format}"`);
    return 1;
  }
  if (!["medium", "high"].includes(values["min-confidence"])) {
    console.error(`--min-confidence must be medium or high`);
    return 1;
  }

  let files: string[];
  try {
    files = await expandInputs(positionals);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }

  let failed = false;
  const jsonOut: unknown[] = [];
  for (const file of files) {
    try {
      const text = await readFile(file, "utf8");
      let raw: unknown = text;
      try {
        raw = JSON.parse(text);
      } catch {
        /* plain-text transcript */
      }
      const result = extract(raw, {
        format: values.format as InputFormat,
        minConfidence: values["min-confidence"] as "medium" | "high",
        fallbackId: path.basename(file, ".json"),
        ...(values["extracted-at"] ? { extractedAt: values["extracted-at"] } : {}),
      });
      let written: string | null = null;
      if (result.fixture && !values["dry-run"]) {
        await mkdir(values.out, { recursive: true });
        written = path.join(values.out, `${result.fixture.id}.json`);
        await writeFile(written, JSON.stringify(result.fixture, null, 2) + "\n", "utf8");
      }
      if (values.json) jsonOut.push({ file, findings: result.findings, fixture: result.fixture, written });
      else console.log(describe(file, result, written) + "\n");
    } catch (error) {
      failed = true;
      console.error(`${file}: ${(error as Error).message}\n`);
    }
  }
  if (values.json) console.log(JSON.stringify(jsonOut, null, 2));
  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, "") === path.resolve(import.meta.filename).replace(/\.ts$/, "");
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
