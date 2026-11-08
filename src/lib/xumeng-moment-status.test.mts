import test from "node:test";
import assert from "node:assert/strict";
import momentModule from "./xumeng-moment-status";

const {
  buildXumengMomentInstruction, currentXumengMomentStatus, splitXumengMomentTail, stripXumengMomentTails,
} = momentModule as typeof import("./xumeng-moment-status");

test("moment tails stay out of the story while streaming and after they close", () => {
  assert.equal(splitXumengMomentTail("她放下杯子。\n<xumeng-mom").body, "她放下杯子。");
  assert.equal(splitXumengMomentTail("她放下杯子。\n<xumeng-moment>{\"affection\":").body, "她放下杯子。");
  const reply = "她放下杯子。\n<xumeng-moment>{\"affection\":140,\"mood\":\"松了口气\",\"scene\":\"她的房间<script>\",\"intimacy\":\"高\",\"clothing\":\"外套还在\",\"secret\":\"没被点破\",\"need\":\"想再坐一会儿\",\"bond\":45,\"bondLabel\":\"拉锯\"}</xumeng-moment>\n<xumeng-panel>{\"panels\":{}}</xumeng-panel>";
  const { body, snapshot } = splitXumengMomentTail(reply);
  assert.equal(body.includes("她放下杯子。"), true);
  assert.equal(body.includes("affection"), false);
  assert.equal(snapshot?.affection, 100);
  assert.equal(snapshot?.scene, "她的房间");
  assert.equal(stripXumengMomentTails(reply).includes("affection"), false);
});

test("later turns keep fields the model did not repeat", () => {
  const state = currentXumengMomentStatus([
    { role: "assistant", content: "开场" },
    { role: "assistant", content: "嗯。\n<xumeng-moment>{\"affection\":30,\"mood\":\"平静\",\"scene\":\"吧台\"}</xumeng-moment>" },
    { role: "user", content: "再坐一会儿" },
    { role: "assistant", content: "好。\n<xumeng-moment>{\"affection\":36,\"mood\":\"松了口气\"}</xumeng-moment>" },
  ]);
  assert.equal(state.reported, true);
  assert.equal(state.status.affection, 36);
  assert.equal(state.status.mood, "松了口气");
  assert.equal(state.status.scene, "吧台");
  assert.match(buildXumengMomentInstruction(state.status), /<xumeng-moment>/);
  assert.match(buildXumengMomentInstruction(state.status), /21 岁以上/);
  assert.doesNotMatch(buildXumengMomentInstruction(state.status), /校服/);
});
