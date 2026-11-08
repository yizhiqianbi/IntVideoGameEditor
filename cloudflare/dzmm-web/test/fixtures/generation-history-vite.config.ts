import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
const root = fileURLToPath(new URL("../../", import.meta.url));
const isolation: Plugin = { name: "generation-history-local-assets-only", configureServer(server) {
  server.middlewares.use((request, response, next) => {
    const path = request.url?.split("?")[0] ?? "";
    if (/^\/api\/backend\/v1\/generation\/assets\/original-[a-z-]+-image$/.test(path)) {
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")); return;
    }
    if (path.startsWith("/api/")) { response.writeHead(501, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify({ error: "Only isolated history fixtures are available; no backend or provider proxy." })); return; }
    next();
  });
} };
export default defineConfig({ root, publicDir: false, envDir: false, envPrefix: "GENERATION_HISTORY_FIXTURE_PUBLIC_", plugins: [react(), isolation],
  resolve: { alias: { "@": resolve(root, "../../src") }, dedupe: ["react", "react-dom"] }, server: { host: "127.0.0.1", port: 21439, strictPort: true, hmr: false } });
