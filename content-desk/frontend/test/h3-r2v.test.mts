import assert from "node:assert/strict";
import test from "node:test";
import { h3CanvasGraph, h3CanvasSize, h3R2vGraph, h3R2vPrompt, runH3CanvasVideo, runH3ReferenceVideo } from "../src/h3-r2v";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64");
const promptId = "202ee206-5759-4770-a52b-6e34a7711450";

test("an r2v prompt puts the reference person into the template video", () => {
  const prompt = h3R2vPrompt("h3-facial", "把参考图中的成年人物放进这条动作模板。\n补充要求：节奏慢一些");
  assert.ok(prompt);
  assert.match(prompt ?? "", /<Picture 1>/);
  assert.match(prompt ?? "", /<Video 1>/);
  assert.doesNotMatch(prompt ?? "", /Image 1/);
  assert.match(prompt ?? "", /脸、发型、肤色、五官和年龄外观从第一帧到最后一帧都来自 <Picture 1>/);
  assert.match(prompt ?? "", /替换模板里原来的人/);
  assert.match(prompt ?? "", /不把 <Video 1> 的脸安到主体上/);
  assert.match(prompt ?? "", /精液射在她脸上/);
  assert.match(prompt ?? "", /节奏慢一些/);
  assert.match(prompt ?? "", /0–2秒：先站住/);
  assert.match(prompt ?? "", /无面部漂移、无身份更换/);
  assert.doesNotMatch(prompt ?? "", /起始画面|不把人物换成别人|不要把参考图当成第一帧/);
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

test("canvas video uses every connected image, video and audio as a reference", async () => {
  const image = "pencil_stills/" + "ab".repeat(16) + ".png";
  const video = "pencil_refs/" + "cd".repeat(16) + ".mp4";
  const audio = "pencil_refs/" + "ef".repeat(16) + ".wav";
  const graph = h3CanvasGraph({ images: [image, image], videos: [video], audios: [audio] }, "她转身看向窗外", "a".repeat(32), 3);
  assert.equal(graph["7"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.equal("first_frame" in graph["7"].inputs, false);
  assert.deepEqual(graph["7"].inputs["ref_images.ref_image_0"], ["20", 0]);
  assert.deepEqual(graph["7"].inputs["ref_images.ref_image_1"], ["21", 0]);
  assert.deepEqual(graph["7"].inputs["ref_videos.ref_video_0"], ["60", 0]);
  assert.deepEqual(graph["7"].inputs["ref_audios.ref_audio_0"], ["70", 0]);
  assert.equal(graph["7"].inputs.prompt, "她转身看向窗外");
  assert.equal(graph["7"].inputs.width, 480);
  assert.equal(graph["7"].inputs.height, 864);
  assert.equal(graph["7"].inputs.length, 122);
  assert.deepEqual(h3CanvasSize(), { width: 480, height: 864 });
  assert.deepEqual(h3CanvasSize("16:9"), { width: 864, height: 480 });
  assert.deepEqual(h3CanvasSize("1:1"), { width: 480, height: 480 });
  assert.equal(h3CanvasSize("21:9"), null);
  const wide = h3CanvasGraph({ images: [image], videos: [], audios: [] }, "她转身看向窗外", "c".repeat(32), 3, 5, h3CanvasSize("16:9")!);
  assert.equal(wide["7"].inputs.width, 864);
  assert.equal(wide["7"].inputs.height, 480);
  const long = h3CanvasGraph({ images: [image], videos: [], audios: [] }, "她转身看向窗外", "b".repeat(32), 3, 15);
  assert.equal(long["7"].inputs.length, 362);
  const response = await runH3CanvasVideo({
    base: "https://gpu.example",
    token: "t".repeat(32),
    prompt: "她转身看向窗外",
    image: png,
    sleep: async () => {},
    now: (() => { let clock = 0; return () => clock++ > 8 ? 300_000 : 0; })(),
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/pencil/input-image")) return Response.json({ file: image });
      if (url.endsWith("/pencil/h3/prompt")) return Response.json({ prompt_id: promptId, node_errors: {} });
      if (url.endsWith(`/history/${promptId}`)) return Response.json({ [promptId]: { status: { completed: true }, outputs: { "16": { filename: `h3_canvas_${"cd".repeat(16)}_00001_.mp4` } } } });
      if (url.includes("/view?")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "video/mp4" } });
      return new Response("missing", { status: 404 });
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /video\/mp4/);
  const missing = await runH3CanvasVideo({
    base: "https://gpu.example", token: "t".repeat(32), prompt: "她转身", image: "",
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(missing.status, 400);
  const audioOnly = await runH3CanvasVideo({
    base: "https://gpu.example", token: "t".repeat(32), prompt: "她转身", audios: ["data:audio/wav;base64," + "a".repeat(32)],
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(audioOnly.status, 400);
  const tooLong = await runH3CanvasVideo({
    base: "https://gpu.example", token: "t".repeat(32), prompt: "她转身", image: png, seconds: 16,
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(tooLong.status, 400);
});

test("a canvas video sends the official rewrite to H3 with its line breaks", async () => {
  const official = "subject_definitions: <Subject 1> from <Picture 2>\n\nsummary: [keyframe completion + reference generation] rain\n\nretention_analysis: x\n\ndetailed_description: [Shot 1] <Picture 1> opens.\n\noverall_soundscape: rain\n\nnon_diegetic_music: N/A";
  let sent = "";
  let seen: { label: string; kind: string }[] = [];
  const response = await runH3CanvasVideo({
    base: "https://gpu.example", token: "t".repeat(32), prompt: "她撑伞回头", images: [png, png], labels: ["回头", "角色·林夏"],
    rewrite: async (_source, references) => { seen = references; return official; },
    sleep: async () => {},
    now: (() => { let clock = 0; return () => clock++ > 8 ? 300_000 : 0; })(),
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/pencil/input-image")) return Response.json({ file: "pencil_stills/" + "ab".repeat(16) + ".png" });
      if (url.endsWith("/pencil/h3/prompt")) {
        sent = JSON.parse(String(init?.body)).prompt["7"].inputs.prompt;
        return Response.json({ prompt_id: promptId, node_errors: {} });
      }
      if (url.endsWith(`/history/${promptId}`)) return Response.json({ [promptId]: { status: { completed: true }, outputs: { "16": { filename: `h3_canvas_${"cd".repeat(16)}_00001_.mp4` } } } });
      if (url.includes("/view?")) return new Response(new Uint8Array([1]), { headers: { "Content-Type": "video/mp4" } });
      return new Response("missing", { status: 404 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-H3-Prompt"), "official");
  assert.equal(sent, official);
  assert.deepEqual(seen.map((item) => item.label), ["回头", "角色·林夏"]);
  assert.match((seen[0] as { data?: string }).data ?? "", /^data:image\/png;base64,/);
});
