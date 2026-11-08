import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { renderKrea2Still } from "../../src/lib/xumeng-krea2-bridge";
import react from "@vitejs/plugin-react";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "../../src/lib/xumeng-feature-availability";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const repositorySource = resolve(frontendRoot, "../../src");
const publicAssets = resolve(frontendRoot, "../../public/dzmm");
const jumpRoot = resolve(frontendRoot, "jump");
const assetTypes: Record<string, string> = {
  ".mp4": "video/mp4", ".webp": "image/webp", ".gif": "image/gif", ".png": "image/png", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".js": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

const previewUser = {
  id: "local-preview-guest", email: null, nickname: "本地预览", isGuest: true, role: "user",
};
const previewState = {
  version: 1, favorites: [], custom: [], conversations: [],
  preferences: { nickname: "游客", persona: "", preset: "保持角色性格。", model: "qwen", dark: true },
};

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function serveVideoCatalog(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") { sendJson(res, 405, { error: "请求方法不支持。" }); return; }
  try {
    const upstream = await fetch("https://video.xumengchat.top/catalog.json", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (upstream.ok) {
      const body = Buffer.from(await upstream.arrayBuffer());
      JSON.parse(body.toString("utf8"));
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    await upstream.body?.cancel();
  } catch { /* Keep the checked-in catalog when the video host does not answer. */ }
  const file = resolve(frontendRoot, "../video-web/public/catalog.json");
  if (!existsSync(file)) { sendJson(res, 404, { error: "视频目录不存在。" }); return; }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
}

function servePublishedAssets(): Plugin {
  return {
    name: "xumeng-published-assets",
    configureServer(server) {
      const krea2Base = (loadEnv(server.config.mode, frontendRoot, "").KREA2_ACTIONS_URL || process.env.KREA2_ACTIONS_URL || "").replace(/\/$/, "");
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (pathname === "/ops" || pathname === "/ops/") {
          if (req.method !== "GET" && req.method !== "HEAD") { sendJson(res, 405, { error: "请求方法不支持。" }); return; }
          const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
          req.url = `/ops.html${query}`;
          next();
          return;
        }
        if (pathname === "/assets/xumeng/video-catalog.json") {
          void serveVideoCatalog(req, res);
          return;
        }
        if (pathname === "/api/aiapi/still" || pathname === "/api/aiapi/video") {
          sendJson(res, 503, { error: "渠道试接要在线上工人里跑。本机预览的参考图渠道拉不到。" });
          return;
        }
        if (pathname === "/api/krea2/generate") {
          if (!XUMENG_GENERATION_WORKSPACE_ENABLED) { sendJson(res, 503, { error: "图片与视频生成已暂停开放。", code: "generation_paused" }); return; }
          if (req.method !== "POST") { sendJson(res, 405, { error: "请求方法不支持。" }); return; }
          const chunks: Buffer[] = [];
          req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on("end", () => {
            void (async () => {
              let body: unknown = {};
              try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { sendJson(res, 400, { error: "请求格式无效。" }); return; }
              const rendered = await renderKrea2Still(krea2Base, body);
              res.statusCode = rendered.status;
              rendered.headers.forEach((value, name) => res.setHeader(name, value));
              res.end(Buffer.from(await rendered.arrayBuffer()));
            })().catch(() => sendJson(res, 503, { error: "出图服务暂时连不上。" }));
          });
          return;
        }
        // Vite has no companion container. Say so in JSON instead of returning the SPA shell.
        if (pathname === "/api/xumeng/companion/api" || pathname.startsWith("/api/xumeng/companion/api/")
          || pathname === "/api/xumeng/companion-intimate/api" || pathname.startsWith("/api/xumeng/companion-intimate/api/")) {
          sendJson(res, 503, { ready: false, error: "本地预览没有女友聊天服务。", code: "PREVIEW_UNAVAILABLE" });
          return;
        }
        // Vite has no Worker. These replies only let the local template page render.
        if (pathname.startsWith("/api/backend/v1/")) {
          const path = pathname.slice("/api/backend/v1".length);
          // The shelf reads the public catalog. Local preview has no worker, so this GET is forwarded read-only.
          if (req.method === "GET" && (path === "/publishing/catalog" || path.startsWith("/publishing/catalog/"))) {
            const incoming = new URL(req.url ?? "/", "http://127.0.0.1");
            const target = `https://xumengchat.top/api/backend/v1${path}${incoming.search}`;
            void fetch(target, { headers: { accept: "application/json" } }).then(async (upstream) => {
              res.statusCode = upstream.status;
              res.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
              res.setHeader("cache-control", "no-store");
              res.end(Buffer.from(await upstream.arrayBuffer()));
            }).catch(() => sendJson(res, 503, { error: "本地预览连不上公共目录。" }));
            return;
          }
          if (path === "/auth/login" && req.method === "POST") return sendJson(res, 401, { error: "本地预览没有账号服务。线上用 Super 登录后打开 /ops，才能看到管理数据。" });
          if (path === "/session" && req.method === "GET") return sendJson(res, 200, { user: previewUser, authenticated: false });
          if (path === "/auth/guest" && req.method === "POST") return sendJson(res, 200, { user: previewUser, authenticated: false });
          if (path === "/state" && req.method === "GET") return sendJson(res, 200, { state: previewState, version: 0, initialized: true, user: previewUser });
          if (path === "/characters" && req.method === "GET") return sendJson(res, 200, { characters: [] });
          if (path === "/generation/config" && req.method === "GET") return sendJson(res, 200, {
            accountId: previewUser.id, enabled: true, costMultiplier: 3,
            models: [
              { id: "preview-image", label: "预览图片", kind: "image", aspectRatios: ["1:1", "3:4", "16:9"], resolutions: ["1K"], durations: [], supportsReferenceImage: true },
              { id: "preview-video", label: "预览视频", kind: "video", aspectRatios: ["16:9", "9:16", "1:1"], resolutions: ["720p"], durations: [5], supportsReferenceImage: true },
            ],
          });
          if (path === "/generation/jobs" && req.method === "GET") return sendJson(res, 200, { accountId: previewUser.id, jobs: [] });
        }
        if (pathname === "/jump" || pathname.startsWith("/jump/")) {
          const relative = pathname === "/jump" || pathname === "/jump/" ? "catch.html" : pathname.slice("/jump/".length);
          let decoded = relative;
          try { decoded = decodeURIComponent(relative); } catch { return next(); }
          if (!decoded || decoded.includes("\0") || decoded.split("/").some(part => part === "." || part === "..")) return next();
          const file = existsSync(resolve(jumpRoot, decoded)) ? resolve(jumpRoot, decoded) : resolve(jumpRoot, `${decoded}.html`);
          if (file !== jumpRoot && !file.startsWith(`${jumpRoot}${sep}`)) return next();
          if (!existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader("Content-Type", extname(file) === ".html" ? "text/html; charset=utf-8" : (assetTypes[extname(file)] ?? "application/octet-stream"));
          res.setHeader("Cache-Control", "no-store");
          if (req.method === "HEAD") { res.statusCode = 200; res.end(); return; }
          if (req.method !== "GET") return next();
          createReadStream(file).pipe(res);
          return;
        }
        if (!pathname.startsWith("/assets/xumeng/")) return next();
        let relative = pathname.slice("/assets/xumeng/".length);
        try { relative = decodeURIComponent(relative); } catch { return next(); }
        if (!relative || relative.includes("\0") || relative.split("/").some(part => part === "..")) return next();
        const file = resolve(publicAssets, relative);
        if (file !== publicAssets && !file.startsWith(`${publicAssets}${sep}`)) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", assetTypes[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "HEAD") { res.statusCode = 200; res.end(); return; }
        if (req.method !== "GET") return next();
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: frontendRoot,
  base: "/",
  plugins: [react(), servePublishedAssets()],
  publicDir: false,
  // Never load the editor repository's .env files into the standalone build.
  envDir: frontendRoot,
  envPrefix: "DZMM_PUBLIC_",
  resolve: {
    alias: { "@": repositorySource },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(frontendRoot, "index.html"),
        ops: resolve(frontendRoot, "ops.html"),
      },
    },
  },
});
