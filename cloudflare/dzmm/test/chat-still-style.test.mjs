import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { stillPrompt } = await tsImport("../src/chat-media.ts", import.meta.url);

test("chat stills use the scene text and leave look to the reference image", () => {
  const scene = "她站在窗边，提起一部动漫。夜里的街道很安静。";
  const photo = stillPrompt(scene, true, { appearance: "黑长发" });
  assert.equal(photo, scene);
  assert.equal(stillPrompt(scene, false), scene);
  assert.doesNotMatch(photo, /参考图|画风|镜头|自愿成年人|外貌|赛璐璐|禁止写实/);
});
