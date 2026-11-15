import { jsonError, readNodeBody, sendWebResponse } from "../../xumeng-gen/lib/remove-outerwear.mjs";

const TARGET = "http://127.0.0.1:3477/api/remove-outerwear";

async function forward(req, body) {
  const response = await fetch(TARGET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-adult-confirmed": req.headers["x-adult-confirmed"] || "",
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(300_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = new Headers();
  headers.set("content-type", response.headers.get("content-type") || "application/octet-stream");
  headers.set("cache-control", "no-store");
  return new Response(bytes, { status: response.status, headers });
}

export function removeOuterwearApi() {
  const attach = server => {
    server.middlewares.use((req, res, next) => {
      const path = (req.url || "").split("?")[0];
      if (path !== "/api/remove-outerwear") {
        next();
        return;
      }
      readNodeBody(req).then(body => forward(req, body)).then(response => sendWebResponse(res, response)).catch(() => {
        sendWebResponse(res, jsonError("去外套服务暂时不可用。", 502));
      });
    });
  };
  return {
    name: "remove-outerwear-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
