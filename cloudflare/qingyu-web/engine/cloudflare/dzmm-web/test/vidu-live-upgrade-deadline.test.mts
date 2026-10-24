import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { Socket as TcpSocket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const { WebSocketServer } = createRequire(import.meta.url)("ws") as { WebSocketServer: new (options: unknown) => any };

test("isolated WebSocket upgrade compares persistent AbortSignal timeout with a cleared handshake deadline", { timeout: 15_000 }, async t => {
  const serverObservations = new Map<string, { openedAt: number; closedAt?: number; closeCode?: number; messages: number; pongs: number }>();
  const connections = new Set<TcpSocket>();
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  server.on("connection", socket => { connections.add(socket); socket.on("close", () => connections.delete(socket)); });
  const wsServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const variant = new URL(request.url!, "http://isolated.test").searchParams.get("variant")!;
    if (variant === "slow") {
      // This intentionally never upgrades, to exercise only the handshake bound.
      socket.on("error", () => {}); socket.on("close", () => {});
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws: any) => {
      const observation = { openedAt: Date.now(), messages: 0, pongs: 0 };
      serverObservations.set(variant, observation);
      const pulse = setInterval(() => { if (ws.readyState === 1) { ws.send("isolated upstream frame"); ws.ping(); } }, 50);
      ws.on("message", () => observation.messages++); ws.on("pong", () => observation.pongs++);
      ws.on("close", (code: number) => { clearInterval(pulse); Object.assign(observation, { closedAt: Date.now(), closeCode: code }); });
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { for (const socket of wsServer.clients) socket.terminate(); wsServer.close(); for (const socket of connections) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const port = (server.address() as { port: number }).port;
  const script = `
    const samples = new Map();
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    export default { async fetch(request, env, ctx) {
      const url = new URL(request.url), variant = url.searchParams.get("variant");
      if (url.pathname === "/status") return Response.json(samples.get(variant) ?? null);
      const sample = { variant, startedAt: Date.now(), deadlineMs: 500, messages: 0, closed: false }; samples.set(variant, sample);
      const abort = new AbortController();
      let timer;
      const signal = variant === "persistent" ? AbortSignal.timeout(500) : abort.signal;
      if (variant !== "persistent") timer = setTimeout(() => abort.abort(), 500);
      let result;
      try {
        result = await fetch(env.LOCAL_UPSTREAM + "/connect?variant=" + variant, { headers: { Upgrade: "websocket" }, redirect: "manual", signal });
        sample.handshakeStatus = result.status; sample.handshakeAt = Date.now();
      } catch {
        sample.handshakeRejected = true; sample.handshakeAt = Date.now();
        return Response.json(sample);
      } finally { if (timer !== undefined) clearTimeout(timer); }
      const ws = result.webSocket;
      if (!ws || result.status !== 101) { sample.invalidHandshake = true; return Response.json(sample); }
      ws.addEventListener("message", () => { sample.messages++; sample.lastMessageAt = Date.now(); });
      ws.addEventListener("close", event => { sample.closed = true; sample.closedAt = Date.now(); sample.closeCode = event.code; });
      ws.addEventListener("error", () => { sample.errorAt = Date.now(); });
      ws.accept(); ws.send("isolated initial control");
      ctx.waitUntil((async () => {
        await pause(1400);
        sample.observedAt = Date.now(); sample.readyStateAfterDeadline = ws.readyState;
        if (ws.readyState === 1) { ws.send("isolated control after handshake deadline"); sample.sentAfterDeadline = true; }
        await pause(100); sample.finalObservedAt = Date.now();
      })());
      return Response.json(sample);
    }};`;
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "isolated-upgrade-timeout", modules: true, script, compatibilityDate: "2026-10-02", bindings: { LOCAL_UPSTREAM: `http://127.0.0.1:${port}` } }] }));
  t.after(() => mf.dispose());
  const start = async (variant: string) => {
    const result = await mf.dispatchFetch(`http://isolated.test/start?variant=${variant}`);
    return await result.json() as Record<string, any>;
  };
  const initial = await Promise.all([start("persistent"), start("cleared")]);
  for (const sample of initial) assert.equal(sample.handshakeStatus, 101);
  const slow = await start("slow"); assert.equal(slow.handshakeRejected, true); assert.ok(slow.handshakeAt - slow.startedAt < 2000);
  await new Promise(resolve => setTimeout(resolve, 1600));
  const workerObservations = await Promise.all(["persistent", "cleared"].map(async variant => {
    const result = await mf.dispatchFetch(`http://isolated.test/status?variant=${variant}`); return await result.json() as Record<string, any>;
  }));
  const cleared = workerObservations.find(item => item.variant === "cleared")!;
  assert.equal(cleared.closed, false); assert.equal(cleared.readyStateAfterDeadline, 1); assert.equal(cleared.sentAfterDeadline, true);
  assert.ok(cleared.messages >= 2); assert.ok(serverObservations.get("cleared")!.pongs >= 1);
  const report = { sampledAt: new Date().toISOString(), scope: "loopback Node ws server + Miniflare workerd, no provider/API keys/media/model calls", handshakeDeadlineMs: 500,
    initial, slowHandshake: slow, workerObservations, serverObservations: Object.fromEntries(serverObservations),
    conclusion: workerObservations.find(item => item.variant === "persistent")?.closed
      ? "Persistent AbortSignal timeout closed the upgraded WebSocket; cancelling the handshake timer preserved it."
      : "Persistent AbortSignal timeout did not close the upgraded WebSocket in this isolated runtime; no causal confirmation." };
  const output = new URL("../../../output/xumeng/s2-upgrade-abort-isolated-20261009.json", import.meta.url);
  const outputPath = fileURLToPath(output.href);
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ conclusion: report.conclusion, workerObservations, serverObservations: report.serverObservations, slowHandshakeRejected: slow.handshakeRejected }) + "\n");
});
