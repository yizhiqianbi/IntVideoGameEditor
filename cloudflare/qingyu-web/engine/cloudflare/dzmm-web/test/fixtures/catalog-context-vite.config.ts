import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../../", import.meta.url));
const isolation: Plugin = {
  name: "catalog-context-no-backend",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split("?")[0] ?? "";
      if (path.startsWith("/api/")) {
        response.writeHead(501, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "This fixture has no backend or external proxy." })); return;
      }
      if (path.startsWith("/assets/qingyu/") || path === "/__catalog-context/cover.svg") {
        response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#20242e"/><path d="M45 100h210v180H45z" fill="#39536b"/><path d="m65 235 60-75 45 45 45-55 25 85z" fill="#b3d0bd"/><text x="150" y="330" text-anchor="middle" fill="white" font-size="18">本地验收封面</text></svg>'); return;
      }
      next();
    });
  },
};

// Deliberately does not merge the app dev config: no provider bridge or env loading.
export default defineConfig({ root, publicDir: false, envDir: false, envPrefix: "CATALOG_CONTEXT_FIXTURE_PUBLIC_",
  plugins: [react(), isolation], resolve: { alias: { "@": resolve(root, "../../src") }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 21437, strictPort: true, hmr: false },
});
