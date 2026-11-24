import assert from "node:assert/strict";
import test from "node:test";
import { writeH3OfficialPrompt } from "../src/h3-official-prompt";

const env = { CANVAS_AGENT_API_KEY: "k".repeat(40), CANVAS_AGENT_MODEL: "x-ai/grok-4.7" };
const six = "subject_definitions: a\n\nsummary: b\n\nretention_analysis: c\n\ndetailed_description: [Shot 1] d\n\noverall_soundscape: e\n\nnon_diegetic_music: N/A";
const reply = (content: string) => async () => Response.json({ choices: [{ message: { content } }] });

test("the official rewrite keeps six sections and sends the guides and pictures", async () => {
  let body: { messages: { role: string; content: unknown }[] } | null = null;
  const written = await writeH3OfficialPrompt(env, "她回头", [{ kind: "image", label: "回头", data: "data:image/jpeg;base64,AA" }], {
    fetchImpl: async (_input, init) => { body = JSON.parse(String(init?.body)); return reply("好的：\n" + six)(); },
  });
  assert.equal(written, six);
  assert.match(String(body!.messages[0].content), /Ref2VA|retention_analysis/);
  const parts = body!.messages[1].content as { type: string; text?: string }[];
  assert.match(parts[0].text ?? "", /vertical 480x864/);
  assert.match(parts[0].text ?? "", /<Picture 1>：回头/);
  let wide = "";
  await writeH3OfficialPrompt(env, "她回头", [{ kind: "image", label: "回头", data: "data:image/jpeg;base64,AA" }], {
    width: 864,
    height: 480,
    fetchImpl: async (_input, init) => {
      wide = JSON.parse(String(init?.body)).messages[1].content[0].text;
      return reply(six)();
    },
  });
  assert.match(wide, /horizontal 864x480/);
  assert.equal(parts[1].type, "image_url");
});

test("a rewrite without all sections falls back", async () => {
  assert.equal(await writeH3OfficialPrompt(env, "她回头", [{ kind: "image", label: "x" }], { fetchImpl: reply("summary: only") }), null);
  assert.equal(await writeH3OfficialPrompt(env, "她回头", [{ kind: "image", label: "x" }], { fetchImpl: async () => new Response("no", { status: 500 }) }), null);
  assert.equal(await writeH3OfficialPrompt({}, "她回头", [{ kind: "image", label: "x" }], { fetchImpl: reply(six) }), null);
});
