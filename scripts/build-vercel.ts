/**
 * npm run build:vercel
 *
 * Produces .vercel/output (Vercel Build Output API v3):
 *   static/                     the built React app (same origin as the API)
 *   functions/api.func/         one Node 22 function running the ReplayKit API,
 *                               bundled with esbuild, plus examples/ and fixtures/
 *   config.json                 routes: /api/* -> function, everything else static
 *
 * Vercel uses this folder as-is, so nothing depends on how Vercel would
 * otherwise compile TypeScript.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const out = ".vercel/output";
const fn = path.join(out, "functions/api.func");

rmSync(out, { recursive: true, force: true });

// 1. Frontend, served same-origin: no API base URL needed.
execSync("npx vite build --config frontend/vite.config.ts", { stdio: "inherit", env: { ...process.env, VITE_PUBLIC_DEMO: "1", VITE_API_BASE: "" } });
cpSync("frontend/dist", path.join(out, "static"), { recursive: true });

// 2. API function. The banner points the server at the data copied beside the bundle.
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["src/web/vercel-function.ts"],
  outfile: path.join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  banner: {
    js: [
      'import { fileURLToPath as __rkFileURLToPath } from "node:url";',
      'import { dirname as __rkDirname } from "node:path";',
      'import { createRequire as __rkCreateRequire } from "node:module";',
      "const require = __rkCreateRequire(import.meta.url);",
      "process.env.REPLAYKIT_ROOT ??= __rkDirname(__rkFileURLToPath(import.meta.url));",
    ].join("\n"),
  },
  logLevel: "info",
});
cpSync("examples", path.join(fn, "examples"), { recursive: true });
cpSync("fixtures", path.join(fn, "fixtures"), { recursive: true });
writeFileSync(
  path.join(fn, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60, memory: 1024 }, null, 2),
);

// 3. Routing and headers.
writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/(.*)", headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" }, continue: true },
        { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "/api/(.*)", dest: "/api?__path=$1" },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${out}: static/, functions/api.func/, config.json`);
