import assert from "node:assert/strict";
import test from "node:test";
import { h3R2vGraph, h3R2vPrompt, runH3ReferenceVideo } from "../src/h3-r2v";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64");
const promptId = "202ee206-5759-4770-a52b-6e34a7711450";

test("an r2v prompt puts the reference person into the template video", () => {
  const prompt = h3R2vPrompt("h3-facial", "把参考图中的成年人物放进这条动作模板。\n补充要求：节奏慢一些");
  assert.ok(prompt);
  assert.match(prompt ?? "", /<Picture 1>/);
  assert.match(prompt ?? "", /<Video 1>/);
  assert.match(prompt ?? "", /替换模板里原来的人/);
  assert.match(prompt ?? "", /精液射在她脸上/);
  assert.match(prompt ?? "", /节奏慢一些/);
  assert.doesNotMatch(prompt ?? "", /起始画面|不把人物换成别人/);
  assert.match(prompt ?? "", /无未成年人/);
  assert.equal(h3R2vPrompt("krea2-ahegao", ""), null);
  const graph = h3R2vGraph("pencil_stills/a".padEnd(46, "0") + ".png", "pencil_refs/b.mp4", prompt ?? "", "a".repeat(32), 21);
  assert.equal(graph["7"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.equal("first_frame" in graph["7"].inputs, false);
  assert.equal(graph["10"].inputs.steps, 4);
});

test("a reference image and template video become one mp4", async () => {
  const calls: string[] = [];
  const response = await runH3ReferenceVideo({
    base: "https://gpu.example",
    token: "t".repeat(32),
    templateId: "h3-ahegao",
    extra: "",
    image: png,
    templateVideo: new Uint8Array(64),
    sleep: async () => {},
    now: (() => { let clock = 0; return () => clock++ > 8 ? 300_000 : 0; })(),
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/pencil/input-image")) return Response.json({ file: "pencil_stills/" + "ab".repeat(16) + ".png" });
      if (url.endsWith("/pencil/references")) return Response.json({ file: "pencil_refs/ok.mp4" });
      if (url.endsWith("/pencil/h3/prompt")) return Response.json({ prompt_id: promptId, node_errors: {} });
      if (url.endsWith(`/history/${promptId}`)) return Response.json({ [promptId]: { status: { status_str: "success", completed: true }, outputs: { "16": { filename: `h3_r2v_${"cd".repeat(16)}_00001_.mp4` } } } });
      if (url.includes("/view?")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "video/mp4" } });
      return new Response("missing", { status: 404 });
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /video\/mp4/);
  assert.equal(calls.some(call => call.includes("/upload/image")), false);
});

test("a missing reference image does not start a video", async () => {
  const response = await runH3ReferenceVideo({
    base: "https://gpu.example", token: "t".repeat(32), templateId: "h3-ahegao", extra: "", image: "", templateVideo: new Uint8Array(64),
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(response.status, 400);
});
