#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const host = "127.0.0.1";
const portArgument = process.argv.slice(2).find(value => value.startsWith("--port="));
const port = Number(portArgument?.slice("--port=".length) ?? process.env.XUMENG_ANDROID_FIXTURE_PORT ?? 18765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Fixture port must be between 1 and 65535.");

const page = await readFile(new URL("./fixture.html", import.meta.url));
const cookieName = "xumeng_android_fixture";
const fixtureDownload = JSON.stringify({ fixture: "xumeng-android", source: "http", harmless: true }, null, 2);
const server = createServer((request, response) => {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const respond = (status, body, contentType, extraHeaders = {}) => {
    response.writeHead(status, { ...headers, "Content-Type": contentType, ...extraHeaders });
    response.end(request.method === "HEAD" ? undefined : body);
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    respond(405, "GET and HEAD only. No account or model API is available.", "text/plain; charset=utf-8", { Allow: "GET, HEAD" });
    return;
  }
  let path;
  try { path = new URL(request.url, `http://${host}:${port}`).pathname; }
  catch { respond(400, "Invalid URL.", "text/plain; charset=utf-8"); return; }

  if (path === "/" || path === "/fixture.html") {
    respond(200, page, "text/html; charset=utf-8");
  } else if (path === "/cookie") {
    respond(200, JSON.stringify({ fixture: true }), "application/json; charset=utf-8", {
      "Set-Cookie": `${cookieName}=present; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
    });
  } else if (path === "/check") {
    const present = (request.headers.cookie ?? "").split(";").some(value => value.trim() === `${cookieName}=present`);
    respond(200, JSON.stringify({ hasFixtureCookie: present }), "application/json; charset=utf-8");
  } else if (path === "/download") {
    respond(200, fixtureDownload, "application/json; charset=utf-8", {
      "Content-Disposition": 'attachment; filename="fixture-http.json"',
    });
  } else if (path === "/health") {
    respond(200, JSON.stringify({ fixture: true, ready: true }), "application/json; charset=utf-8");
  } else if (path === "/favicon.ico") {
    response.writeHead(204, headers); response.end();
  } else {
    respond(404, "Fixture route not found. No production API is proxied.", "text/plain; charset=utf-8");
  }
});

server.listen(port, host, () => {
  console.log(`Android isolated fixture: http://${host}:${port}/`);
  console.log("No production API, model, credentials, or account data are used.");
});
server.on("error", error => { console.error(`Fixture server failed: ${error.code ?? error.message}`); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
