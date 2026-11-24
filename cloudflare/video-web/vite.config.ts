import { existsSync, statSync, createReadStream } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));
const sampleRoot = resolve(root, "../../hgtv_sample");
const types: Record<string,string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".json": "application/json" };

function localMedia(): Plugin {
  return {
    name: "local-authorized-media",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (!pathname.startsWith("/media/")) return next();
        const relative = decodeURIComponent(pathname.slice("/media/".length));
        if (!relative || relative.includes("\0") || relative.split("/").some((p) => p === "..")) return next();
        const file = resolve(sampleRoot, relative);
        if (!file.startsWith(`${sampleRoot}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "HEAD") { res.statusCode = 200; res.end(); return; }
        if (req.method !== "GET") return next();
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({ root, base: "/", plugins: [react(), localMedia()], publicDir: "public", build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" } });
