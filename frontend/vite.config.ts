import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// Fail the build early on a malformed API URL instead of shipping a broken demo.
const apiBase = process.env.VITE_API_BASE;
if (apiBase && !/^https?:\/\/[^/\s]+(\/[^\s]*)?$/.test(apiBase)) {
  throw new Error(`VITE_API_BASE must be an http(s) URL like https://replaykit-api.up.railway.app, got "${apiBase}"`);
}
if (apiBase?.startsWith("http://") && process.env.VERCEL) {
  throw new Error("VITE_API_BASE must use https on Vercel; browsers block http API calls from an https page.");
}

// `npm run dev:web` serves this app with hot reload on :5173 and proxies the
// API to the ReplayKit server on :4321. `npm run build:web` writes dist/,
// which the server serves directly.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:4321" } },
});
