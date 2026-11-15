import test from "node:test";
import assert from "node:assert/strict";
import frontendCard from "./xumeng-frontend-card";

const { applyXumengFrontendScripts, parseXumengFrontendScripts } = frontendCard;

const prison = {
  extensions: {
    regex_scripts: [
      {
        id: "frame", scriptName: "处境浮标", findRegex: "/<Status_block>([\\s\\S]*?)<\\/Status_block>/g",
        replaceString: "<div class=\"buoy\">$1</div>", trimStrings: [], placement: [2],
        disabled: false, markdownOnly: true, promptOnly: false, minDepth: null, maxDepth: null,
      },
      {
        id: "row", scriptName: "字段", findRegex: "/\\[(位置|危机感)\\|([^\\]]*)\\]/g",
        replaceString: "<div class=\"row\"><b>$1</b><span>$2</span></div>", trimStrings: [], placement: [1, 2],
        disabled: false, markdownOnly: true, promptOnly: false, minDepth: null, maxDepth: null,
      },
    ],
  },
};

test("a card keeps its display regex and ignores a broken pattern", () => {
  const scripts = parseXumengFrontendScripts({
    extensions: { regex_scripts: [...prison.extensions.regex_scripts, { findRegex: "", replaceString: "x" }, { findRegex: "/[/g", replaceString: "nope" }] },
  });
  assert.equal(scripts?.length, 3);
  assert.equal(scripts?.[0]?.name, "处境浮标");
  assert.equal(scripts?.[0]?.markdownOnly, true);
  assert.equal(applyXumengFrontendScripts("门外。\n<Status_block>\n[位置|牢房]\n[危机感|高]\n</Status_block>", scripts, { role: "assistant", depth: 0, pass: "display" }),
    "门外。\n<div class=\"buoy\">\n<div class=\"row\"><b>位置</b><span>牢房</span></div>\n<div class=\"row\"><b>危机感</b><span>高</span></div>\n</div>");
});

test("display regex stays out of the prompt, and a prompt regex stays out of the bubble", () => {
  const scripts = parseXumengFrontendScripts(prison);
  const text = "<Status_block>[位置|牢房]</Status_block>";
  assert.equal(applyXumengFrontendScripts(text, scripts, { role: "assistant", depth: 0, pass: "prompt" }), text);
  const hidden = parseXumengFrontendScripts({ frontendScripts: [{ id: "hide", name: "隐藏", find: "/秘密/g", replace: "", placement: [2], promptOnly: true, markdownOnly: false }] });
  assert.equal(applyXumengFrontendScripts("这是秘密。", hidden, { role: "assistant", depth: 0, pass: "display" }), "这是秘密。");
  assert.equal(applyXumengFrontendScripts("这是秘密。", hidden, { role: "assistant", depth: 0, pass: "prompt" }), "这是。");
});

test("depth, role and a disabled script decide whether a beautifier runs", () => {
  const scripts = parseXumengFrontendScripts({
    frontendScripts: [
      { id: "old", name: "旧", find: "/标记/g", replace: "旧界面", placement: [2], markdownOnly: true, minDepth: 1 },
      { id: "off", name: "关", find: "/标记/g", replace: "不该出现", placement: [2], markdownOnly: true, disabled: true },
    ],
  });
  assert.equal(applyXumengFrontendScripts("标记", scripts, { role: "assistant", depth: 0, pass: "display" }), "标记");
  assert.equal(applyXumengFrontendScripts("标记", scripts, { role: "assistant", depth: 2, pass: "display" }), "旧界面");
  assert.equal(applyXumengFrontendScripts("标记", scripts, { role: "user", depth: 2, pass: "display" }), "标记");
});
