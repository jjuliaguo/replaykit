import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// `npm run dev:web` serves this app with hot reload on :5173 and proxies the
// API to the ReplayKit server on :4321. `npm run build:web` writes dist/,
// which the server serves directly.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:4321" } },
});
