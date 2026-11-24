import { test } from "node:test";
import { strict as assert } from "node:assert";
import { newShot } from "../src/lib/drama";
import { newAsset, shotContext } from "../src/lib/drama-assets";
import {
  attachAssets,
  bindProjectAssets,
  composeShotPrompt,
  parseLabeledShotPrompt,
  parseScriptShot,
  parsePromptSettings,
  DEFAULT_PROMPT_SETTINGS,
  recommendVideoPlan,
  visibleShotPrompt,
} from "../src/lib/drama-prompt";

test("retired built-in prompts migrate while custom project text stays intact", () => {
  const settings = parsePromptSettings({
    style: "写实电影感，皮肤与织物材质清楚，贴肤暖光，浅景深，细胶片颗粒。无文字、无水印、无Logo。",
    audio: "保留呼吸、织物、皮肤接触与床品声；对白短促并放在引号里，口型同步。",
    camera: "我自己的固定机位",
    lighting: "我自己的夜景灯光",
    negative: "不要烟雾",
  });
  assert.equal(settings.style, DEFAULT_PROMPT_SETTINGS.style);
  assert.equal(settings.audio, DEFAULT_PROMPT_SETTINGS.audio);
  assert.equal(settings.camera, "我自己的固定机位");
  assert.equal(settings.lighting, "我自己的夜景灯光");
  assert.equal(settings.negative, "不要烟雾");
});

test("script shots accept structured fields and 3–15 second duration", () => {
  const shot = parseScriptShot(
    {
      title: "贴着墙",
      duration: 8,
      start: "她被抵在门上",
      action: "他缓慢抽送",
      camera: "中近景缓慢靠近",
      setting: "酒店套房暖光",
      sound: "呼吸和水声",
      end: "额头相抵",
    },
    0,
  );
  assert.equal(shot.duration, 8);
  assert.equal(shot.prompt, "他缓慢抽送");
  assert.equal(shot.promptFields.camera, "中近景缓慢靠近");
  const composed = composeShotPrompt(shot);
  assert.match(composed, /规格：8秒/);
  assert.match(composed, /时间轴：/);
  assert.match(composed, /0–2秒：她被抵在门上/);
  assert.match(composed, /中间：他缓慢抽送/);
  assert.match(composed, /末1–2秒：额头相抵/);
  assert.match(composed, /镜头：中近景缓慢靠近/);
  assert.match(composed, /声音：呼吸和水声/);
  assert.doesNotMatch(composed, /负面：/);
});

test("legacy blob prompts still parse as action-only", () => {
  const shot = parseScriptShot({ prompt: "她接通电话" }, 2);
  assert.equal(shot.title, "镜头 3");
  assert.equal(shot.prompt, "她接通电话");
  assert.equal(composeShotPrompt(shot), "她接通电话");
});

test("binding a pictured card inserts @ and 10Eros-Max auto-selects RI2V", () => {
  const card = {
    ...newAsset("reference", 0),
    title: "林晚",
    imageUrl: "https://example.com/lin.png",
  };
  const shot = bindProjectAssets(newShot(0, "开门", "他把她抵在门上"), [card]);
  assert.ok(shot.assetIds?.includes(card.id));
  assert.match(shot.prompt, /@Image1/);
  assert.equal(shot.referenceBindings?.Image1, `asset:${card.id}`);
  const plan = recommendVideoPlan({
    tone: "explicit",
    hasReferenceImages: true,
    gpu: { ltx: { ready: true, t2v: true } },
  });
  assert.equal(plan.videoModel, "h3");
  assert.equal(plan.mode, "ri2v");
});

test("checking a tail-frame card does not rebind other reference cards", () => {
  const actor = { ...newAsset("reference", 0), title: "林晚" };
  const scene = { ...newAsset("scene", 1), title: "酒店套房" };
  const frame = { ...newAsset("reference", 2), title: "开门 · 尾帧" };
  const shot = attachAssets(
    { ...newShot(0, "开门", "他把她抵在门上"), assetIds: [frame.id] },
    [actor, scene, frame],
  );
  assert.deepEqual(shot.assetIds, [frame.id]);
  const project = bindProjectAssets(newShot(0, "开门", "他把她抵在门上"), [
    actor,
    scene,
    frame,
  ]);
  assert.deepEqual(new Set(project.assetIds), new Set([actor.id, scene.id]));
});

test("retired tones still use continuous H3 shots without adult routing copy", () => {
  assert.deepEqual(
    recommendVideoPlan({
      tone: "explicit",
      gpu: { ltx: { ready: true, t2v: true } },
    }),
    {
      videoModel: "h3",
      mode: "t2v",
      duration: 15,
      reason: "按剧情生成连续单镜头，使用 H3 文生视频。",
    },
  );
  assert.equal(
    recommendVideoPlan({ duration: 8, tone: "explicit" }).duration,
    8,
  );
  assert.equal(
    recommendVideoPlan({ duration: 30, tone: "explicit" }).duration,
    15,
  );
  assert.deepEqual(
    recommendVideoPlan({
      duration: 8,
      tone: "explicit",
      gpu: { ltx: { ready: true, t2v: true } },
    }),
    {
      videoModel: "h3",
      mode: "t2v",
      duration: 8,
      reason: "按剧情生成连续单镜头，使用 H3 文生视频。",
    },
  );
  assert.equal(
    recommendVideoPlan({
      modelPick: "manual",
      videoModel: "h3",
      duration: 8,
    }).duration,
    8,
  );
  assert.equal(
    recommendVideoPlan({
      firstFrame: "https://example.com/start.png",
      gpu: { ltx: { ready: true, t2v: true } },
    }).videoModel,
    "h3",
  );
});

test("10Eros-Max RI2V keeps Image labels in the composed prompt", () => {
  const card = {
    ...newAsset("reference", 0),
    title: "林晚",
    imageUrl: "https://example.com/lin.png",
    description: "26岁",
  };
  const shot = {
    ...newShot(0, "门", "亲吻"),
    videoModel: "h3" as const,
    mode: "ri2v" as const,
    assetIds: [card.id],
  };
  assert.equal(shotContext(shot, [card]).mode, "ri2v");
  assert.match(shotContext(shot, [card]).prompt, /Image 1 = 锁定角色「林晚」/);
  assert.match(shotContext(shot, [card]).prompt, /26岁/);
});

test("Sulphur keeps T2V when linked cards have images", () => {
  const card = {
    ...newAsset("reference", 0),
    imageUrl: "https://example.com/a.png",
    description: "26岁",
  };
  const shot = {
    ...newShot(0, "门", "亲吻"),
    videoModel: "ltx-sulphur" as const,
    assetIds: [card.id],
  };
  assert.equal(shotContext(shot, [card]).mode, "t2v");
  assert.match(shotContext(shot, [card]).prompt, /26岁/);
});

test("a single labeled prompt roundtrips into structured fields", () => {
  const shot = parseScriptShot(
    {
      start: "她被抵在门上",
      action: "他缓慢抽送",
      camera: "中近景缓慢靠近",
      setting: "酒店套房暖光",
      sound: "呼吸和水声",
      end: "额头相抵",
    },
    0,
  );
  const visible = visibleShotPrompt(shot);
  assert.match(visible, /起始：她被抵在门上/);
  assert.match(visible, /动作：他缓慢抽送/);
  const parsed = parseLabeledShotPrompt(visible);
  assert.equal(parsed.prompt, "他缓慢抽送");
  assert.equal(parsed.promptFields.camera, "中近景缓慢靠近");
  assert.equal(parsed.promptFields.end, "额头相抵");
  assert.equal(visibleShotPrompt({ ...shot, ...parsed }), visible);
});

test("labeled action is not truncated at 2000 characters", () => {
  const action = "他缓慢抽送，她贴着门板迎上去。".repeat(150);
  assert.ok(action.length > 2000);
  const parsed = parseLabeledShotPrompt(
    ["起始：她被抵在门上", `动作：${action}`, "结束：额头相抵"].join("\n"),
  );
  assert.equal(parsed.prompt, action);
  assert.equal(parsed.promptFields.action, action);
  assert.equal(parsed.promptFields.start, "她被抵在门上");
});

test("freeform prompt stays a single action field", () => {
  const parsed = parseLabeledShotPrompt("他把她抵在门上亲吻");
  assert.equal(parsed.prompt, "他把她抵在门上亲吻");
  assert.deepEqual(parsed.promptFields, { action: "他把她抵在门上亲吻" });
  assert.equal(visibleShotPrompt(parsed), "他把她抵在门上亲吻");
});

test("fixed prompt settings and audio usage enter the composed shot", () => {
  const shot = parseScriptShot(
    { action: "他缓慢抽送", start: "她靠在门上" },
    0,
  );
  const text = composeShotPrompt(
    {
      ...shot,
      referenceMedia: [
        {
          id: "a".repeat(32),
          kind: "audio",
          name: "moan.wav",
          url: "/api/drama/reference-media?id=a",
          duration: 8,
          prompt: "跟随 Audio 1 的呼吸节奏",
        },
      ],
    },
    {
      style: "写实贴肤光",
      camera: "中近景固定",
      lighting: "暖光",
      audio: "保留呼吸",
      negative: "",
    },
  );
  assert.match(text, /规格：15秒/);
  assert.match(text, /风格：写实贴肤光/);
  assert.match(text, /镜头：中近景固定/);
  assert.match(text, /Audio 1 用法：跟随 Audio 1 的呼吸节奏/);
  assert.doesNotMatch(text, /负面：/);
});

test("stored specialized model identity remains available to archive adapters", () => {
  const plan = recommendVideoPlan({
    modelPick: "manual",
    videoModel: "ltx-pinkcherry25",
    mode: "ri2v",
    hasReferenceImages: true,
    gpu: { ltx: { ready: true, t2v: true } },
  });
  assert.equal(plan.videoModel, "ltx-pinkcherry25");
  assert.equal(plan.mode, "ri2v");
});

test("audio and video references route to H3 RI2V", () => {
  const audio = recommendVideoPlan({
    tone: "explicit",
    hasReferenceAudio: true,
    gpu: { ltx: { ready: true, t2v: true } },
  });
  assert.equal(audio.videoModel, "h3");
  assert.equal(audio.mode, "ri2v");
  assert.match(audio.reason, /音频/);
  const video = recommendVideoPlan({
    hasReferenceVideo: true,
    gpu: { ltx: { ready: true, t2v: true } },
  });
  assert.equal(video.mode, "ri2v");
  assert.match(video.reason, /视频/);
});
