import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATE_DEFAULT_COUNT,
  CONTINUE_DEFAULT_COUNT,
  buildNovelPayload,
  handleNovel,
} from "./novel-request.mjs";

function request(body, headers = {}) {
  return new Request("http://127.0.0.1:3488/api/novel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-adult-confirmed": "1", ...headers },
    body: JSON.stringify(body),
  });
}

async function read(response) {
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  return { status: response.status, type, text, json: type.includes("json") ? JSON.parse(text) : null };
}

test("new-write payload includes all fields and defaults count to 4000", () => {
  const built = buildNovelPayload({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: "旅人沉稳少言。",
    location_scene: "多雾的港口。",
    details: "用纪实口吻写。",
  });
  assert.equal(built.ok, true);
  assert.equal(built.id, "generate-novel");
  assert.deepEqual(built.values, {
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: "旅人沉稳少言。",
    location_scene: "多雾的港口。",
    details: "用纪实口吻写。",
    count: String(GENERATE_DEFAULT_COUNT),
  });
  assert.deepEqual(built.files, {});
});

test("empty optional fields are omitted", () => {
  const built = buildNovelPayload({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: "  ",
    location_scene: "",
    details: "",
    count: "4000",
  });
  assert.equal(built.ok, true);
  assert.deepEqual(Object.keys(built.values).sort(), ["count", "description"]);
  assert.equal(built.values.count, "4000");
});

test("missing plot is rejected", () => {
  const built = buildNovelPayload({ mode: "new", description: "" });
  assert.equal(built.ok, false);
  assert.equal(built.error, "先写剧情。");
});

test("continue defaults to 2000 and packs source as a file", () => {
  const built = buildNovelPayload({
    mode: "continue",
    source: "第一章已经写完的正文。",
    character_setting: "旅人沉稳少言。",
  });
  assert.equal(built.ok, true);
  assert.equal(built.id, "continue-novel");
  assert.equal(built.values.count, String(CONTINUE_DEFAULT_COUNT));
  assert.equal(built.values.character_setting, "旅人沉稳少言。");
  assert.ok(built.files.file_url?.data);
  assert.equal(Buffer.from(built.files.file_url.data, "base64").toString("utf8"), "第一章已经写完的正文。");
});

test("continue rejects a 4000 count", () => {
  const built = buildNovelPayload({ mode: "continue", source: "已有正文一段。", count: "4000" });
  assert.equal(built.ok, false);
  assert.match(built.error, /500–2000/);
});

test("illegal ids and extra fields are rejected", () => {
  const extra = buildNovelPayload({ mode: "new", description: "一个三十岁的旅人走进港口旧书店。", id: "generate-undress-images" });
  assert.equal(extra.ok, false);
  assert.equal(extra.code, "field-forbidden");
  const provider = buildNovelPayload({ mode: "new", description: "一个三十岁的旅人走进港口旧书店。", provider: "other" });
  assert.equal(provider.ok, false);
});

test("handler rejects cross-origin, missing adult, and does not forward bad requests", async () => {
  let forwarded = 0;
  const forward = async () => {
    forwarded += 1;
    return new Response("should-not-run");
  };
  const noAdult = await read(await handleNovel(request({ mode: "new", description: "一个三十岁的旅人走进港口旧书店。" }, { "x-adult-confirmed": "" }), { forward }));
  assert.equal(noAdult.status, 403);
  const cross = await read(await handleNovel(
    request({ mode: "new", description: "一个三十岁的旅人走进港口旧书店。" }, { origin: "http://127.0.0.1:3999", host: "127.0.0.1:3488" }),
    { forward },
  ));
  assert.equal(cross.status, 403);
  const missing = await read(await handleNovel(request({ mode: "new" }), { forward }));
  assert.equal(missing.status, 400);
  assert.equal(forwarded, 0);
});

test("successful mock text is returned and errors are not faked as success", async () => {
  const ok = await read(await handleNovel(request({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: "旅人沉稳少言。",
    location_scene: "多雾的港口。",
    details: "用纪实口吻写。",
    count: "4000",
  }), {
    forward: async payload => {
      assert.equal(payload.id, "generate-novel");
      assert.equal(payload.values.count, "4000");
      assert.equal(payload.values.character_setting, "旅人沉稳少言。");
      return new Response("港口的 bell 还在响。", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    },
  }));
  assert.equal(ok.status, 200);
  assert.match(ok.type, /text\/plain/);
  assert.equal(ok.text, "港口的 bell 还在响。");

  const failed = await read(await handleNovel(request({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
  }), {
    forward: async () => new Response(JSON.stringify({ error: "渠道试接还没配上密钥。", code: "unconfigured" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  }));
  assert.equal(failed.status, 503);
  assert.equal(failed.json.error, "渠道试接还没配上密钥。");
  assert.notEqual(failed.status, 200);
});

test("forward timeout becomes 504", async () => {
  const result = await read(await handleNovel(request({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
  }), {
    forward: async () => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    },
  }));
  assert.equal(result.status, 504);
  assert.equal(result.json.code, "timeout");
});
