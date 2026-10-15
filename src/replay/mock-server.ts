import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { JsonValue } from "../shared/json.js";
import type { ReplayFixture, ToolDefinition } from "../shared/types.js";
import { ReplaySession, resultPayload } from "./session.js";
import type { ToolInvokeResult } from "./types.js";

export type MockRequestLog = {
  method: string;
  url: string;
  toolName?: string;
  matched: boolean;
  status: number;
};

export type MockServer = {
  port: number;
  url: string;
  log: MockRequestLog[];
  session: ReplaySession;
  close: () => Promise<void>;
};

type Route = { method: string; path: string; toolName: string };

/**
 * Deterministic HTTP stand-in for recorded tool webhooks.
 * Routes are derived from fixture tool endpoints — nothing is booking-specific.
 */
export function createMockServer(fixture: ReplayFixture, session = new ReplaySession(fixture)): { server: Server; session: ReplaySession; log: MockRequestLog[] } {
  const routes = routesFor(fixture.tools);
  const log: MockRequestLog[] = [];

  const server = createServer((req, res) => {
    void handle(req, res, fixture, session, routes, log);
  });

  return { server, session, log };
}

export async function listenMockServer(fixture: ReplayFixture, port = 3000): Promise<MockServer> {
  const { server, session, log } = createMockServer(fixture);
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    log,
    session,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function routesFor(tools: ToolDefinition[]): Route[] {
  const routes: Route[] = [];
  for (const tool of tools) {
    routes.push({ method: "POST", path: `/tools/${encodeURIComponent(tool.name)}`, toolName: tool.name });
    const url = tool.endpoint?.url;
    if (!url) continue;
    try {
      const parsed = new URL(url);
      routes.push({
        method: (tool.endpoint?.method ?? "POST").toUpperCase(),
        path: parsed.pathname.replace(/\/$/, "") || "/",
        toolName: tool.name,
      });
    } catch {
      const path = url.startsWith("/") ? url : `/${url}`;
      routes.push({ method: (tool.endpoint?.method ?? "POST").toUpperCase(), path, toolName: tool.name });
    }
  }
  return routes;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  fixture: ReplayFixture,
  session: ReplaySession,
  routes: Route[],
  log: MockRequestLog[],
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (method === "GET" && path === "/health") {
    json(res, 200, { ok: true, fixtureId: fixture.id, interactions: fixture.replay.interactions.length });
    return;
  }
  if (method === "GET" && path === "/log") {
    json(res, 200, { requests: log, session: session.log });
    return;
  }

  const bodyText = await readBody(req);
  let parsed: JsonValue = bodyText;
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText) as JsonValue;
    } catch {
      parsed = bodyText;
    }
  }

  const toolName = matchTool(method, path, routes, req.headers["x-replay-tool"]);
  if (!toolName) {
    log.push({ method, url: path, matched: false, status: 404 });
    console.log(`[unmatched] ${method} ${path}`);
    json(res, 404, { replaykit: true, unmatched: true, message: `No tool is mounted at ${method} ${path}` });
    return;
  }

  const result = session.invoke(toolName, parsed);
  const { status, payload } = httpFromResult(result);
  log.push({ method, url: path, toolName, matched: result.matched, status });
  const tag = result.matched ? "matched" : "unmatched";
  console.log(`[${tag}] ${method} ${path} -> ${toolName} status ${status}`);
  json(res, status, payload);
}

function matchTool(method: string, path: string, routes: Route[], header: string | string[] | undefined): string | undefined {
  if (typeof header === "string" && header) return header;
  const hit = routes.find((r) => r.method === method && r.path === path);
  return hit?.toolName;
}

function httpFromResult(result: ToolInvokeResult): { status: number; payload: JsonValue } {
  if (result.kind === "response") {
    return { status: result.status ?? 200, payload: result.body ?? {} };
  }
  if (result.kind === "error") {
    return { status: result.error?.kind === "timeout" ? 504 : 502, payload: resultPayload(result) };
  }
  if (result.kind === "fail_run") {
    return { status: 409, payload: resultPayload(result) };
  }
  return { status: result.status ?? 404, payload: result.body ?? { unmatched: true } };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: JsonValue): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
