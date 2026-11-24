import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  completionText,
  normalizeScriptDocument,
  parseScriptJson,
} from "../src/lib/drama-script-parse";

test("accepts Chinese keys, storyboard lists, and extra shots", () => {
  const script = normalizeScriptDocument({
    片名: "门关上之后",
    角色: [
      { name: "林晚", 设定: "26岁，黑色长发", type: "角色" },
      { name: "套房", description: "暖光酒店", type: "场景" },
    ],
    storyboard: [
      { 镜头名: "抵门", 动作: "他缓慢抽送", duration: "8秒" },
      { title: "亲吻", description: "两人贴着门吻" },
      ...Array.from({ length: 14 }, (_, i) => ({ action: `多余镜 ${i}` })),
    ],
  });
  assert.equal(script.title, "门关上之后");
  assert.equal(script.shots.length, 12);
  assert.equal(script.shots[0].prompt, "他缓慢抽送");
  assert.equal(script.shots[0].title, "抵门");
  assert.equal(script.assets.length, 2);
  assert.equal(script.assets[0].kind, "reference");
  assert.equal(script.assets[1].kind, "scene");
});

test("recovers complete shots from truncated model JSON", () => {
  const raw = `废话 {"title":"门","shots":[{"title":"一","action":"接吻"},{"title":"二","action":"抽送"},{"title":"三","act`;
  const parsed = parseScriptJson(raw);
  const script = normalizeScriptDocument(parsed);
  assert.equal(script.shots.length, 2);
  assert.equal(script.shots[1].prompt, "抽送");
});

test("accepts Grok variants: case, wrappers, arrays, missing action", () => {
  const fromArray = normalizeScriptDocument(
    parseScriptJson(`说明\n\`\`\`json\n[{"Action":"接吻"},{"Action":"抽送"}]\n\`\`\``),
  );
  assert.equal(fromArray.shots.length, 2);
  assert.equal(fromArray.shots[0].prompt, "接吻");

  const nested = normalizeScriptDocument({
    data: {
      Title: "门关上之后",
      Shots: {
        a: { promptFields: { Action: "他抵住门" } },
        b: { start: "贴着墙", camera: "近景", setting: "酒店套房" },
      },
    },
  });
  assert.equal(nested.title, "门关上之后");
  assert.equal(nested.shots.length, 2);
  assert.equal(nested.shots[0].prompt, "他抵住门");
  assert.match(nested.shots[1].prompt, /贴着墙/);

  const trailing = parseScriptJson(
    `{"title":"门","shots":[{"action":"接吻",},{"action":"抽送",},],}`,
  );
  assert.equal(normalizeScriptDocument(trailing).shots.length, 2);
});

test("accepts more messy Grok payloads that previously yielded zero shots", () => {
  const xmlish = normalizeScriptDocument(
    parseScriptJson(`Sure.\n{"result":{"title":"雨夜","scenes":[{"Name":"走廊","prompt":"她把他按在墙上吻"}]}}`),
  );
  assert.equal(xmlish.shots.length, 1);
  assert.equal(xmlish.shots[0].prompt, "她把他按在墙上吻");

  const numbered = normalizeScriptDocument({
    SHOTS: {
      "1": { 动作: "解衬衫" },
      "2": { fields: { 描述: "吻锁骨" } },
    },
  });
  assert.equal(numbered.shots.length, 2);

  const single = normalizeScriptDocument({ Action: "两人靠在门板上喘息" });
  assert.equal(single.shots.length, 1);
  assert.match(single.shots[0].prompt, /门板/);
});

test("reads OpenRouter/Grok content arrays and reasoning", () => {
  assert.equal(
    completionText({
      choices: [
        {
          message: {
            content: [{ type: "text", text: '{"shots":[{"action":"吻"}]}' }],
          },
        },
      ],
    }),
    '{"shots":[{"action":"吻"}]}',
  );
  assert.match(
    completionText({
      choices: [{ message: { content: "", reasoning: '{"shots":[]}' } }],
    }),
    /shots/,
  );
});

test("strips BOM and zero-width characters before a Grok JSON response", () => {
  const parsed = parseScriptJson("\uFEFF\u200B{\"title\":\"雨夜\",\"shots\":[{\"action\":\"关门\"}]}");
  assert.equal(parsed.title, "雨夜");
  assert.equal((parsed.shots as unknown[]).length, 1);
});

test("uses the final storyboard without appending reasoning drafts", () => {
  const answer = JSON.stringify({ title: "匿名来信", assets: [], shots: [{ title: "发现信封", action: "调查员拿起桌上的信封" }] });
  const result = completionText({ choices: [{ message: {
    content: answer,
    reasoning: '草稿 {"shots":[{"title":"...","action":"..."}]} 示例 {"title":"角色","description":"人物设定"}',
    reasoning_content: '{"shots":[{"action":"未采用的镜头"}]}',
  } }] });
  assert.equal(result, answer);
  const script = normalizeScriptDocument(parseScriptJson(result));
  assert.equal(script.title, "匿名来信");
  assert.equal(script.shots.length, 1);
  assert.equal(script.shots[0].title, "发现信封");
});
