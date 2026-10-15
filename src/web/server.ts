/**
 * ReplayKit local web app.
 *
 * A thin HTTP layer over the two real implementations, with no logic of its own:
 *   - POST /api/extract  -> Claude's extractor  (src/extractor/extract.ts)
 *   - POST /api/replay   -> Cursor's replay engine (src/replay/pipeline.ts)
 * Every finding, pass, and fail shown in the UI is computed by that code from
 * the submitted data. Nothing is cached, invented, or hardcoded here.
 *
 * Local only: binds to 127.0.0.1, uses no network, makes no model calls.
 *
 *   npm run web                  # http://127.0.0.1:4321
 *   npm run web -- --port 8080
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runGoldenPath } from "../e2e/golden-path.js";
import { classifyToolResult } from "../extractor/analysis/tool-outcome.js";
import { extract } from "../extractor/extract.js";
import { EXTRACTOR_VERSION } from "../extractor/version.js";
import { renderHtmlReport } from "../replay/report/html-report.js";
import { runReplaySuite, type AgentSpec } from "../replay/pipeline.js";
import { parseFixture } from "../shared/types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Built React app (frontend/). Built with `npm run build:web`. */
export const DEFAULT_STATIC_DIR = path.join(ROOT, "frontend/dist");
const EXAMPLES_DIR = path.join(ROOT, "examples/call-logs");
const FIXTURE_DIRS = [path.join(ROOT, "fixtures"), path.join(ROOT, "fixtures/generated")];
const MAX_BODY = 2_000_000;
/** The one test the MVP guarantees end to end. */
export const GOLDEN_EXAMPLE = "booking-false-confirmation";

/** Agents the replay engine can run offline. "live" is deliberately absent. */
export const AGENTS = {
  original: { label: "Original agent", description: "Replays the recorded tool calls and the original reply. Reproduces the failure.", spec: { type: "original" } },
  naive: { label: "Naive stand-in", description: "Calls the recorded tools, then always claims success.", spec: { type: "policy", policy: "naive" } },
  skip: { label: "Skip stand-in", description: "Calls no tools and claims success.", spec: { type: "policy", policy: "skip" } },
  honor: { label: "Fixed stand-in", description: "Calls tools and reports failures honestly. A deterministic stand-in for a corrected agent.", spec: { type: "policy", policy: "honor" } },
} as const satisfies Record<string, { label: string; description: string; spec: AgentSpec }>;
type AgentId = keyof typeof AGENTS;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && statSync(path.join(dir, f)).isFile()).sort();
  } catch {
    return [];
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function listExamples() {
  return listJson(EXAMPLES_DIR).map((file) => {
    const data = readJson(path.join(EXAMPLES_DIR, file)) as { id?: string; notes?: string; kind?: string; messages?: unknown };
    return {
      name: file.replace(/\.json$/, ""),
      id: data.id ?? file,
      format: Array.isArray(data.messages) ? "openai-chat" : "calllog",
      kind: data.kind ?? "unknown",
      notes: data.notes ?? "",
    };
  });
}

function fixtureFiles(): Array<{ ref: string; file: string }> {
  return FIXTURE_DIRS.flatMap((dir) =>
    listJson(dir).map((f) => ({ ref: path.relative(path.join(ROOT, "fixtures"), path.join(dir, f)).replaceAll("\\", "/"), file: path.join(dir, f) })),
  );
}

function listFixtures() {
  return fixtureFiles().map(({ ref, file }) => {
    try {
      const f = parseFixture(readJson(file), ref);
      return { ref, id: f.id, name: f.name, kind: f.source.kind, valid: true, failures: f.failures.map((x) => x.type), origin: ref.startsWith("generated/") ? "extractor" : "hand-written" };
    } catch (error) {
      return { ref, id: ref, name: ref, kind: "unknown", valid: false, error: (error as Error).message, failures: [], origin: "unknown" };
    }
  });
}

/** Resolve a name to a known file only; never a caller-supplied path. */
function knownFile(list: Array<{ ref: string; file: string }>, ref: unknown): string {
  const hit = list.find((x) => x.ref === ref);
  if (!hit) throw new HttpError(404, `unknown file: ${String(ref)}`);
  return hit.file;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Serve the built single-page app. Only files inside `staticDir` are served;
 * unknown non-asset paths fall back to index.html for client-side routing.
 */
function serveStatic(res: http.ServerResponse, staticDir: string, pathname: string): void {
  const index = path.join(staticDir, "index.html");
  let indexExists = false;
  try {
    indexExists = statSync(index).isFile();
  } catch {
    /* not built */
  }
  if (!indexExists) {
    return send(res, 503, "ReplayKit frontend is not built yet. Run: npm run build:web", "text/plain; charset=utf-8");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "bad path");
  }
  const target = path.resolve(staticDir, "." + path.posix.normalize("/" + decoded));
  if (target !== staticDir && !target.startsWith(staticDir + path.sep)) throw new HttpError(404, "not found");
  let file = target;
  try {
    if (!statSync(file).isFile()) file = index;
  } catch {
    // Missing assets are real 404s; anything else is a client-side route.
    if (path.extname(decoded)) throw new HttpError(404, "not found");
    file = index;
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  const body = readFileSync(file);
  res.writeHead(200, {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cache-control": file === index ? "no-store" : "public, max-age=31536000, immutable",
  });
  res.end(body);
}

/** Every example call log, run through the extractor: the "Calls" list. */
function listCalls() {
  return listExamples().map((e) => {
    try {
      const r = extract(readJson(path.join(EXAMPLES_DIR, `${e.name}.json`)), { fallbackId: e.name });
      const tools = [...new Set(r.callLog.events.flatMap((ev) => (ev.type === "tool_call" ? [ev.toolName] : [])))];
      return {
        ...e,
        provider: r.callLog.provider,
        startedAt: r.callLog.startedAt ?? null,
        events: r.callLog.events.length,
        toolCalls: r.callLog.events.filter((ev) => ev.type === "tool_call").length,
        tools,
        findings: r.findings.map((f) => ({ type: f.type, confidence: f.confidence, toolName: f.toolName ?? null, summary: f.summary, messageIndex: f.messageIndex })),
        fixtureId: r.fixture?.id ?? null,
        error: null,
      };
    } catch (error) {
      return { ...e, provider: "unknown", startedAt: null, events: 0, toolCalls: 0, tools: [], findings: [], fixtureId: null, error: (error as Error).message };
    }
  });
}

async function handleExtract(body: unknown) {
  const { log, example, minConfidence } = (body ?? {}) as { log?: unknown; example?: string; minConfidence?: string };
  let raw = log;
  let fallbackId = "pasted-log";
  if (raw === undefined && example) {
    raw = readJson(knownFile(listJson(EXAMPLES_DIR).map((f) => ({ ref: f.replace(/\.json$/, ""), file: path.join(EXAMPLES_DIR, f) })), example));
    fallbackId = example;
  }
  if (raw === undefined) throw new HttpError(400, 'send {"log": <call log JSON>} or {"example": "<name>"}');
  if (minConfidence !== undefined && minConfidence !== "medium" && minConfidence !== "high") throw new HttpError(400, "minConfidence must be medium or high");
  try {
    const started = performance.now();
    const result = extract(raw, { fallbackId, ...(minConfidence ? { minConfidence } : {}) });
    // The extractor's own success/failure/unknown verdict for every tool result,
    // keyed by event index, so the UI never re-implements that logic.
    const outcomes = Object.fromEntries(
      result.callLog.events.flatMap((e, i) => (e.type === "tool_result" ? [[i, classifyToolResult(e)]] : [])),
    );
    return {
      durationMs: Math.round((performance.now() - started) * 10) / 10,
      outcomes,
      callLog: { id: result.callLog.id, provider: result.callLog.provider, kind: result.callLog.kind, startedAt: result.callLog.startedAt ?? null, notes: result.callLog.notes ?? null, workflow: result.callLog.workflow ?? null, tools: result.callLog.tools, events: result.callLog.events },
      findings: result.findings.map(({ messageIndex, ...f }) => ({ ...f, messageIndex })),
      fixture: result.fixture,
    };
  } catch (error) {
    throw new HttpError(422, (error as Error).message);
  }
}

async function handleReplay(body: unknown) {
  const { fixture: inline, fixtureRef, agents } = (body ?? {}) as { fixture?: unknown; fixtureRef?: string; agents?: unknown };
  const raw = inline ?? (fixtureRef ? readJson(knownFile(fixtureFiles(), fixtureRef)) : undefined);
  if (raw === undefined) throw new HttpError(400, 'send {"fixture": <fixture JSON>} or {"fixtureRef": "<name>"}');
  const ids = Array.isArray(agents) && agents.length ? agents : ["original", "honor"];
  const unknown = ids.filter((a) => typeof a !== "string" || !(a in AGENTS));
  if (unknown.length) throw new HttpError(400, `unknown agent(s): ${unknown.join(", ")}. Available: ${Object.keys(AGENTS).join(", ")}. Live model runs are not available.`);
  let fixture;
  try {
    fixture = parseFixture(raw, "fixture");
  } catch (error) {
    throw new HttpError(422, (error as Error).message);
  }
  const started = performance.now();
  const report = await runReplaySuite(fixture, (ids as AgentId[]).map((id) => AGENTS[id].spec));
  return { durationMs: Math.round((performance.now() - started) * 10) / 10, agents: ids, report, html: renderHtmlReport(report) };
}

export function createWebServer(options: { staticDir?: string } = {}): http.Server {
  const staticDir = path.resolve(options.staticDir ?? DEFAULT_STATIC_DIR);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;
    try {
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveStatic(res, staticDir, url.pathname);
      }
      switch (route) {
        case "GET /api/calls":
          return send(res, 200, listCalls());
        case "POST /api/e2e": {
          const { example, log } = ((await readBody(req)) ?? {}) as { example?: string; log?: unknown };
          const name = example ?? (log === undefined ? GOLDEN_EXAMPLE : undefined);
          const raw =
            log ?? readJson(knownFile(listExamples().map((e) => ({ ref: e.name, file: path.join(EXAMPLES_DIR, `${e.name}.json`) })), name));
          const started = performance.now();
          const r = await runGoldenPath({ log: raw, fallbackId: name ?? "pasted-log" });
          return send(res, 200, { ...r, example: name ?? null, durationMs: Math.round((performance.now() - started) * 10) / 10 });
        }
        case "GET /api/health":
          return send(res, 200, { ok: true, extractorVersion: EXTRACTOR_VERSION, mode: "offline" });
        case "GET /api/agents":
          return send(res, 200, Object.entries(AGENTS).map(([id, a]) => ({ id, label: a.label, description: a.description })));
        case "GET /api/examples":
          return send(res, 200, listExamples());
        case "GET /api/example": {
          const name = url.searchParams.get("name");
          return send(res, 200, readJson(knownFile(listExamples().map((e) => ({ ref: e.name, file: path.join(EXAMPLES_DIR, `${e.name}.json`) })), name)));
        }
        case "GET /api/fixtures":
          return send(res, 200, listFixtures());
        case "GET /api/fixture":
          return send(res, 200, readJson(knownFile(fixtureFiles(), url.searchParams.get("ref"))));
        case "POST /api/extract":
          return send(res, 200, await handleExtract(await readBody(req)));
        case "POST /api/replay":
          return send(res, 200, await handleReplay(await readBody(req)));
        default:
          throw new HttpError(404, `no route for ${route}`);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      send(res, status, { error: (error as Error).message });
    }
  });
}

export function listen(server: http.Server, port: number, host = "127.0.0.1"): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: actual } = server.address() as AddressInfo;
      resolve(`http://${host}:${actual}`);
    });
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { values } = parseArgs({ options: { port: { type: "string", default: process.env.PORT ?? "4321" } } });
  const port = Number.parseInt(values.port, 10);
  listen(createWebServer(), port).then(
    (url) => console.log(`ReplayKit web app running at ${url}\nOffline mode: no network or model calls. Press Ctrl+C to stop.`),
    (error: NodeJS.ErrnoException) => {
      console.error(error.code === "EADDRINUSE" ? `Port ${port} is in use. Try: npm run web -- --port 4322` : error.message);
      process.exit(1);
    },
  );
}
