import { test } from "node:test";
import { strict as assert } from "node:assert";
import { newShot } from "../src/lib/drama";
import { newAsset } from "../src/lib/drama-assets";
import {
  applyLastFrameMaterial,
  applyStartFrameMaterial,
  shotStillPrompt,
  usesImageToVideo,
} from "../src/lib/drama-frames";

test("I2V stills describe the start pose, not the later action", () => {
  const actor = {
    ...newAsset("reference", 0),
    title: "林晚 · 26岁",
    description: "黑色长发",
  };
  const shot = {
    ...newShot(0, "门关上之后", "她打开录音笔寻找线索"),
    assetIds: [actor.id],
  };
  const prompt = shotStillPrompt(shot, [actor]);
  assert.match(prompt, /开始瞬间/);
  assert.match(prompt, /不要画后续动作/);
  assert.match(prompt, /林晚/);
  assert.match(prompt, /角色外观、道具与场景一致/);
  assert.match(prompt, /她打开录音笔寻找线索/);
  assert.doesNotMatch(prompt, /裸露|情欲|成人向/);
});

test("I2V still prompts stay short even when the shot prompt is very long", () => {
  const shot = newShot(0, "门关上之后", `${"她寻找录音中的线索。".repeat(400)}`);
  const prompt = shotStillPrompt(shot, []);
  assert.ok(prompt.length <= 1500);
  assert.match(prompt, /开始瞬间/);
});

test("last frame is saved as material and fills the next empty I2V first frame", () => {
  const first = {
    ...newShot(0, "门关上之后", "kiss"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
  };
  const next = {
    ...newShot(1, "衬衫滑落", "undress"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
    parentId: first.id,
  };
  const result = applyLastFrameMaterial({
    shot: first,
    shots: [first, next],
    assets: [],
    imageUrl: "data:image/jpeg;base64,abc",
  });
  assert.equal(result.assets[0].title, "门关上之后 · 尾帧");
  assert.equal(result.shots[0].endStill, "data:image/jpeg;base64,abc");
  assert.equal(result.shots[1].firstFrame, "data:image/jpeg;base64,abc");
  assert.ok(result.shots[0].assetIds?.includes(result.assets[0].id));
});

test("last frame does not overwrite a next shot that already has its own still", () => {
  const first = newShot(0, "A", "a");
  const next = { ...newShot(1, "B", "b"), mode: "i2v" as const, firstFrame: "keep", parentId: first.id };
  const result = applyLastFrameMaterial({
    shot: first,
    shots: [first, next],
    assets: [],
    imageUrl: "data:image/jpeg;base64,new",
  });
  assert.equal(result.shots[1].firstFrame, "keep");
});

test("regenerating a last frame updates the same card and a chained next first frame", () => {
  const first = {
    ...newShot(0, "A", "a"),
    endFrameAssetId: "end-1",
    endStill: "old",
  };
  const card = {
    ...newAsset("reference", 0),
    id: "end-1",
    title: "A · 尾帧",
    imageUrl: "old",
  };
  const next = { ...newShot(1, "B", "b"), mode: "i2v" as const, firstFrame: "old", parentId: first.id };
  const result = applyLastFrameMaterial({
    shot: first,
    shots: [first, next],
    assets: [card],
    imageUrl: "new",
  });
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].imageUrl, "new");
  assert.equal(result.shots[1].firstFrame, "new");
});

test("I2V first-frame generation writes a still card onto the shot", () => {
  const shot = { ...newShot(0, "开门", "kiss"), mode: "i2v" as const };
  const result = applyStartFrameMaterial({
    shot,
    shots: [shot],
    assets: [],
    imageUrl: "data:image/png;base64,start",
  });
  assert.equal(result.shots[0].firstFrame, "data:image/png;base64,start");
  assert.equal(result.assets[0].title, "开门 · 首帧");
  assert.equal(usesImageToVideo(shot), true);
  assert.equal(usesImageToVideo(newShot(1)), false);
  assert.equal(
    usesImageToVideo({ ...newShot(2), videoModel: "ltx-sulphur", mode: "t2v" }),
    false,
  );
});

test("last frame does not fill an array-next shot that is not a child", () => {
  const first = {
    ...newShot(0, "A", "a"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
  };
  const next = {
    ...newShot(1, "B", "b"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
  };
  const result = applyLastFrameMaterial({
    shot: first,
    shots: [first, next],
    assets: [],
    imageUrl: "data:image/jpeg;base64,abc",
  });
  assert.equal(result.shots[1].firstFrame, "");
});

test("last frame fills every child I2V shot", () => {
  const first = {
    ...newShot(0, "A", "a"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
  };
  const left = {
    ...newShot(1, "B", "b"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
    parentId: first.id,
  };
  const right = {
    ...newShot(2, "C", "c"),
    mode: "i2v" as const,
    videoModel: "ltx-10eros" as const,
    parentId: first.id,
  };
  const result = applyLastFrameMaterial({
    shot: first,
    shots: [first, left, right],
    assets: [],
    imageUrl: "data:image/jpeg;base64,abc",
  });
  assert.equal(result.shots[1].firstFrame, "data:image/jpeg;base64,abc");
  assert.equal(result.shots[2].firstFrame, "data:image/jpeg;base64,abc");
});
