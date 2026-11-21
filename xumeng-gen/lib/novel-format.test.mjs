import assert from "node:assert/strict";
import { test } from "node:test";
import { NOVEL_FORMAT_INSTRUCTION, parseNovelOutput, plainNovelText, withNovelFormatInstruction } from "./novel-format.mjs";

test("format instruction is appended without dropping user details", () => {
  const value = withNovelFormatInstruction("用纪实口吻写。");
  assert.match(value, /^用纪实口吻写。/);
  assert.match(value, /标题：/);
  assert.equal(withNovelFormatInstruction(""), NOVEL_FORMAT_INSTRUCTION);
  const custom = withNovelFormatInstruction("标题：已有要求");
  assert.equal(custom, "标题：已有要求");
});

test("title is parsed separately and body becomes sections", () => {
  const raw = [
    "标题：雾港旧书店",
    "",
    "## 第一章 雨夜",
    "",
    "旅人推门进来时，风把雨点带进了书店。",
    "",
    "“还开着吗？”他问。",
    "",
    "## 第二章 旧信",
    "",
    "柜台底下压着一封没有寄出的信。",
  ].join("\n");
  const parsed = parseNovelOutput(raw);
  assert.equal(parsed.title, "雾港旧书店");
  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[0].heading, "第一章 雨夜");
  assert.deepEqual(parsed.sections[0].paragraphs, ["旅人推门进来时，风把雨点带进了书店。", "“还开着吗？”他问。"]);
  assert.equal(parsed.sections[1].heading, "第二章 旧信");
  assert.match(plainNovelText(parsed), /^雾港旧书店\n\n第一章 雨夜/);
});

test("markdown h1 title and chapter lines are recognised", () => {
  const raw = ["# 长夜将尽", "", "第一段内容。", "", "第一章 归来", "第二段内容。"].join("\n");
  const parsed = parseNovelOutput(raw);
  assert.equal(parsed.title, "长夜将尽");
  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[0].heading, "");
  assert.equal(parsed.sections[1].heading, "第一章 归来");
});

test("newline-separated paragraphs are split when there are no blank lines", () => {
  const parsed = parseNovelOutput("标题：短篇\n第一段。\n第二段。\n第三段。");
  assert.equal(parsed.title, "短篇");
  assert.deepEqual(parsed.sections[0].paragraphs, ["第一段。", "第二段。", "第三段。"]);
});

test("inline markdown and chapter headings get split out", () => {
  const raw = "标题：雨夜旧书\n\n林晚放下笔。\n\n旅人问书。这里没有。\n\n“随缘。”她答。## 第二章 微光\n\n旅人拿走了那本书。";
  const parsed = parseNovelOutput(raw);
  assert.equal(parsed.title, "雨夜旧书");
  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[1].heading, "第二章 微光");
  assert.equal(parsed.sections[1].paragraphs[0], "旅人拿走了那本书。");
});

test("missing title falls back to the opening line", () => {
  const parsed = parseNovelOutput("雨夜，旅人推门走进旧书店。\n\n他收起伞。");
  assert.equal(parsed.title, "雨夜，旅人推门走进旧书店");
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].paragraphs.length, 2);
});

test("empty output stays empty", () => {
  assert.deepEqual(parseNovelOutput(""), { title: "", sections: [], plain: "", wordCount: 0 });
});
