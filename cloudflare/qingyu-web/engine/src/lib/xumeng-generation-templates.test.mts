import assert from "node:assert/strict";
import test from "node:test";
import { KREA2_IMAGE_GROUPS } from "./xumeng-krea2-stills.ts";
import * as templateExports from "./xumeng-generation-templates.ts";
import * as draftExports from "./xumeng-generation-draft.ts";
import type { GenerationTemplate, GenerationTemplateFilters } from "./xumeng-generation-templates.ts";

const templatesModule = (templateExports as typeof templateExports & { default?: typeof templateExports }).default ?? templateExports;
const {
  GENERATION_TEMPLATES, ACTIVE_GENERATION_TEMPLATES, GENERATION_TEMPLATE_CATEGORIES, fillGenerationTemplate,
  filterGenerationTemplates, getGenerationTemplate, getGenerationTemplateCategory,
  getGenerationTemplateDefaults, isGenerationTemplateCategory,
} = templatesModule as typeof import("./xumeng-generation-templates.ts");
const draft = (draftExports as typeof draftExports & { default?: typeof draftExports }).default ?? draftExports;
const actionIds = ["action-high-five", "action-handshake", "action-hug", "action-object-exchange", "action-side-by-side-walk", "action-paired-dance"];
const archivedVideoIds = ["story-opening", "character-entry", "product-video", "scene-timelapse", "cover-reveal", "daily-vignette"];

test("the catalog keeps retired placeholders while new selections expose H3 videos and adult stills", () => {
  const h3Count = ACTIVE_GENERATION_TEMPLATES.filter(template => template.h3Lora).length;
  const stillCount = ACTIVE_GENERATION_TEMPLATES.filter(template => template.imageProvider === "unfiltered-pending").length;
  const archivedStillCount = GENERATION_TEMPLATES.filter(template => template.archived && template.id.startsWith("still-")).length;
  assert.ok(h3Count >= 16);
  assert.ok(stillCount >= 100);
  assert.equal(archivedStillCount, 8);
  assert.equal(GENERATION_TEMPLATES.length, 24 + archivedStillCount + h3Count + stillCount);
  assert.equal(new Set(GENERATION_TEMPLATES.map(template => template.id)).size, 24 + archivedStillCount + h3Count + stillCount);
  assert.equal(GENERATION_TEMPLATES.filter(template => template.kind === "image").length, 12 + archivedStillCount + stillCount);
  assert.equal(GENERATION_TEMPLATES.filter(template => template.kind === "video").length, 12 + h3Count);
  assert.equal(ACTIVE_GENERATION_TEMPLATES.length, h3Count + stillCount);
  assert.equal(ACTIVE_GENERATION_TEMPLATES.filter(template => template.kind === "image").length, stillCount);
  assert.deepEqual(ACTIVE_GENERATION_TEMPLATES.filter(template => template.kind === "video" && !template.h3Lora).map(template => template.id), []);
  assert.equal(filterGenerationTemplates(), ACTIVE_GENERATION_TEMPLATES);
  assert.ok(ACTIVE_GENERATION_TEMPLATES.every(template => !template.archived));
  for (const template of GENERATION_TEMPLATES) {
    assert.ok(template.englishLabel.trim());
    assert.ok(template.description.length < 40);
    assert.ok(template.categories.length);
    assert.equal(new Set(template.categories).size, template.categories.length);
    assert.ok(template.categories.every(isGenerationTemplateCategory));
    assert.ok(template.tags.length);
    const fieldIds = template.fields.map(field => field.id);
    assert.equal(new Set(fieldIds).size, fieldIds.length);
    assert.deepEqual(Object.keys(template.defaultValues).sort(), [...fieldIds].sort());
    assert.ok(template.fields.every(field => field.description?.trim() && template.defaultValues[field.id]?.trim()));
    assert.deepEqual([...new Set([...template.pattern.matchAll(/\{\{([a-z]+)\}\}/g)].map(match => match[1]))].sort(), [...fieldIds].sort());
    const defaults = getGenerationTemplateDefaults(template)!;
    const prompt = fillGenerationTemplate(template, defaults);
    assert.ok(prompt.length > 20 && prompt.length <= 4000);
    assert.doesNotMatch(prompt, /\{\{[a-z]+\}\}/);
    assert.ok(template.kind === "image" || template.kind === "video");
    assert.ok(!("referenceImage" in template) && !("imageToVideo" in template));
  }
});

test("the original seven IDs, ratios and prompt patterns remain compatible", () => {
  const originals = [
    ["character-portrait", "3:4", "绘制角色立绘：{{subject}}。完整着装，人物轮廓清晰，神态自然，简洁背景。画面风格：{{style}}。不添加文字和水印。"],
    ["scene-image", "16:9", "故事场景概念图：{{scene}}。空间关系合理，突出环境细节与氛围，适合角色扮演的场景背景。风格：{{style}}。不添加文字。"],
    ["novel-cover", "3:4", "小说封面插画底图。主体：{{subject}}。场景：{{scene}}。风格：{{style}}。竖版构图，上方保留标题留白；画面本身不绘制文字和水印。"],
    ["product-image", "1:1", "产品展示海报底图：{{subject}}。环境：{{scene}}。风格：{{style}}。突出产品材质与轮廓，合理光影；不添加品牌、文字或水印。"],
    ["story-opening", "16:9", "短片开场镜头：{{scene}}。缓慢推进镜头，环境中出现自然细微运动，用一个连贯镜头建立故事氛围。风格：{{style}}。不要字幕或水印。"],
    ["character-entry", "9:16", "角色登场短片：{{subject}}，出现在{{scene}}。完整着装，自然走近镜头后停下，露出符合角色的神情。稳定连贯的镜头，保持人物外观一致。风格：{{style}}。不要字幕。"],
    ["product-video", "16:9", "产品展示短片。主体：{{subject}}。场景：{{scene}}。镜头缓慢环绕主体，材质清晰，光影自然。风格：{{style}}。不要字幕、品牌或水印。"],
  ];
  assert.deepEqual(GENERATION_TEMPLATES.slice(0, 7).map(template => template.id), originals.map(([id]) => id));
  for (const [id, ratio, pattern] of originals) {
    assert.equal(getGenerationTemplate(id)?.aspectRatio, ratio);
    assert.equal(getGenerationTemplate(id)?.pattern, pattern);
  }
});

test("the later three archived video prompt snapshots remain unchanged", () => {
  const originals = [
    ["scene-timelapse", "16:9", "环境氛围短片：{{scene}}。使用固定机位，让云、水面、植物或灯光产生自然细微变化，时间推进平缓，保持空间结构稳定。风格：{{style}}。不要字幕或水印。"],
    ["cover-reveal", "9:16", "封面氛围短片。核心意象：{{subject}}。环境：{{scene}}。镜头缓慢靠近主体，末尾停留在清楚的竖版构图，画面上方保留标题留白，环境只有自然细微运动。风格：{{style}}。不要字幕、文字或水印。"],
    ["daily-vignette", "16:9", "原创日常短片。人物与动作：{{subject}}。场景：{{scene}}。完整着装，以一个简单动作和自然表情表现性格，用连贯中景完成片段，保持人物外观与空间关系稳定。风格：{{style}}。不要字幕或水印。"],
  ];
  for (const [id, ratio, pattern] of originals) {
    assert.equal(getGenerationTemplate(id)?.aspectRatio, ratio);
    assert.equal(getGenerationTemplate(id)?.pattern, pattern);
  }
});

test("retired image and action placeholders stay out of new selections", () => {
  for (const category of GENERATION_TEMPLATE_CATEGORIES) {
    assert.equal(getGenerationTemplateCategory(category.id), category);
    if (category.id === "intimate") {
      assert.equal(filterGenerationTemplates({ kind: "image", category: "intimate" }).length > 0, true);
      assert.ok(filterGenerationTemplates({ kind: "image", category: "intimate" }).every(template => template.imageProvider === "unfiltered-pending"));
      assert.ok(filterGenerationTemplates({ kind: "video", category: "intimate" }).every(template => template.h3Lora));
      continue;
    }
    assert.deepEqual(filterGenerationTemplates({ kind: "image", category: category.id }), []);
    assert.deepEqual(filterGenerationTemplates({ kind: "video", category: category.id }), []);
  }
  const entry = getGenerationTemplate("character-entry")!;
  assert.equal(entry.archived, true);
  assert.ok(!filterGenerationTemplates({ kind: "video" }).includes(entry));
  assert.ok(filterGenerationTemplates({ kind: "video", category: "character" }, GENERATION_TEMPLATES).includes(entry));
  assert.equal(getGenerationTemplate("storyboard-sheet")?.archived, true);
  for (const id of actionIds) assert.equal(getGenerationTemplate(id)?.archived, true);
});

test("search matches Chinese labels, English names and tags with normalized AND terms", () => {
  assert.deepEqual(filterGenerationTemplates({ query: "头像" }).map(template => template.id), []);
  assert.deepEqual(filterGenerationTemplates({ query: "ＣＨＡＲＡＣＴＥＲ　ａｖａｔａｒ" }).map(template => template.id), []);
  assert.deepEqual(filterGenerationTemplates({ query: "社交" }).map(template => template.id), []);
  assert.deepEqual(filterGenerationTemplates({ query: "  ＦＬＡＴ　 ＬＡＹ\n配件  ", kind: "image", category: "product" }).map(template => template.id), []);
  assert.deepEqual(filterGenerationTemplates({ query: "cover", kind: "video", category: "cover" }), []);
  assert.deepEqual(filterGenerationTemplates({ query: "双人 握手", kind: "video" }).map(template => template.id), []);
  assert.deepEqual(filterGenerationTemplates({ query: "ＨＩＧＨ　 ＦＩＶＥ", kind: "video" }).map(template => template.id), []);
  assert.equal(getGenerationTemplate("character-avatar")?.label, "角色头像");
  assert.equal(getGenerationTemplate("action-handshake")?.label, "双人握手");
  assert.deepEqual(filterGenerationTemplates({ query: "剧情开场", kind: "video" }), []);
  assert.deepEqual(filterGenerationTemplates({ query: "人物 avatar", kind: "video" }), []);
  assert.deepEqual(filterGenerationTemplates({ query: "未出现的用途" }), []);
});

test("h3 previews keep adult triggers and stay out of the original action set", () => {
  const h3 = ACTIVE_GENERATION_TEMPLATES.filter(template => template.h3Lora);
  const ids = new Set<string>();
  for (const template of h3) {
    assert.equal(ids.has(template.id), false);
    ids.add(template.id);
    assert.equal(template.kind, "video");
    assert.deepEqual(template.categories, ["intimate"]);
    assert.equal(template.actionParticipants, undefined);
    assert.equal(template.archived, undefined);
    assert.equal(template.demoVideoUrl, `/assets/xumeng/h3-actions/${template.id}.mp4`);
    assert.equal(template.demoPosterUrl, `/assets/xumeng/h3-actions/${template.id}.webp`);
    assert.equal(template.h3Lora?.repo, "EllaPriest45/MinimaxH3_Actions");
    assert.match(template.h3Lora?.weightFile ?? "", /\.safetensors$/);
    assert.match(template.h3Lora?.strength ?? "", /^[0-9.]+$/);
    assert.match(template.pattern, /自愿的成年人/);
    assert.doesNotMatch(template.pattern, /触发词|LoRA|MiniMax|H3/);
    assert.equal(template.pattern.includes(template.h3Lora?.trigger ?? "MISSING"), false);
    assert.doesNotMatch(template.pattern, /未成年|校服|loli|shota/i);
    assert.equal(fillGenerationTemplate(template, {}), template.pattern);
    assert.ok(!actionIds.includes(template.id));
  }
});

test("adult stills keep consent language and cannot be billed on the current image models", () => {
  const stills = ACTIVE_GENERATION_TEMPLATES.filter(template => template.imageProvider === "unfiltered-pending");
  const ids = new Set<string>();
  for (const template of stills) {
    assert.equal(ids.has(template.id), false);
    ids.add(template.id);
    assert.equal(template.kind, "image");
    assert.deepEqual(template.categories, ["intimate"]);
    assert.equal(template.h3Lora, undefined);
    assert.equal(template.demoVideoUrl, undefined);
    assert.equal(template.demoPosterUrl, `/assets/xumeng/krea2-actions/${template.id}.webp`);
    assert.match(template.id, /^krea2(?:-[a-z0-9]+)+$/);
    const group = KREA2_IMAGE_GROUPS.find(item => item.id === template.krea2Lora?.group);
    assert.ok(group);
    assert.equal(template.label, group?.label);
    assert.equal(template.krea2Lora?.repo, "EllaPriest45/Krea2_actions");
    assert.match(template.krea2Lora?.weightFile ?? "", /\.safetensors$/);
    assert.match(template.krea2Lora?.strength ?? "", /^[0-9.]+$/);
    assert.ok(template.krea2Lora?.trigger);
    assert.equal(template.pattern.includes(template.krea2Lora?.trigger ?? "MISSING"), false);
    assert.match(template.pattern, /自愿的成年人/);
    assert.match(template.pattern, /。单张静帧/);
    assert.doesNotMatch(template.pattern, /。。/);
    assert.doesNotMatch(template.pattern, /未成年|校服|loli|shota|Krea2|LoRA|触发词|safetensors/i);
    assert.equal(fillGenerationTemplate(template, {}), template.pattern);
  }
  assert.equal(getGenerationTemplate("still-lingerie")?.archived, true);
  assert.ok(filterGenerationTemplates({ query: "口交", kind: "image" }).length > 0);
});

test("action videos compile fixed motions without character, plot, scene or style inputs", () => {
  const prompts = new Set<string>();
  for (const id of actionIds) {
    const template = getGenerationTemplate(id)!;
    assert.deepEqual(template.fields, []);
    assert.deepEqual(template.defaultValues, {});
    assert.equal(template.demoVideoUrl, `/assets/xumeng/action-templates/${id}.mp4`);
    assert.equal(template.demoPosterUrl, `/assets/xumeng/action-templates/${id}.png`);
    assert.equal(template.actionParticipants, 2);
    assert.equal(template.archived, true);
    assert.ok(!filterGenerationTemplates().includes(template));
    const value = draft.createGenerationTemplateDraft(template);
    assert.deepEqual(value, { values: {}, additionalRequirements: "" });
    const prompt = draft.compileGenerationTemplateDraft(template, value);
    assert.equal(prompt, fillGenerationTemplate(template, { subject: "IGNORE_THIS_SUBJECT", scene: "IGNORE_THIS_SCENE", style: "IGNORE_THIS_STYLE" }));
    assert.doesNotMatch(prompt, /IGNORE_THIS|\{\{|海港|书店/);
    assert.match(prompt, /上传的参考图/);
    assert.match(prompt, /两名人物/);
    assert.match(prompt, /背景和画面风格一致/);
    assert.match(prompt, /前段/); assert.match(prompt, /中段/); assert.match(prompt, /末段/);
    assert.match(prompt, /固定机位/); assert.match(prompt, /一个连贯镜头/);
    prompts.add(prompt);
  }
  assert.equal(prompts.size, actionIds.length);
});

test("zero-field action drafts survive refresh with their fixed compiler snapshot and reference", () => {
  for (const id of actionIds) {
    const template = getGenerationTemplate(id)!;
    const value = draft.createGenerationTemplateDraft(template);
    const prompt = draft.compileGenerationTemplateDraft(template, value);
    const referenceImage = { id: `original-${id}` };
    const saved = { schemaVersion: 2, kind: "video", prompt, templateId: id, editorMode: "template", workspaceMode: "create",
      modelId: "video-model", aspectRatio: "16:9", duration: 5, useReferenceImage: true, referenceImage, templateDrafts: { [id]: value } };
    const restored = draft.restoreGenerationWorkspaceDraft(saved)!;
    assert.equal(restored.editorMode, "template");
    assert.equal(restored.prompt, prompt);
    assert.deepEqual(restored.templateDrafts[id], value);
    assert.deepEqual(restored.referenceImage, referenceImage);
    assert.equal(restored.useReferenceImage, true);
  }
});

test("archived video drafts retain exact prompts, fields and reference identity without becoming new selections", () => {
  const retiredIds = GENERATION_TEMPLATES.filter(template => template.archived && !template.h3Lora && !template.imageProvider).map(template => template.id);
  assert.equal(retiredIds.length, 24);
  assert.deepEqual(retiredIds.filter(id => archivedVideoIds.includes(id)), archivedVideoIds);
  for (const id of archivedVideoIds) {
    const template = getGenerationTemplate(id)!;
    const value = draft.createGenerationTemplateDraft(template);
    value.values[template.fields[0].id] = "旧视频参数，必须完整保留";
    value.additionalRequirements = "旧任务补充要求，不得替换成新动作";
    const prompt = draft.compileGenerationTemplateDraft(template, value);
    const saved = { schemaVersion: 2, kind: "video", prompt, templateId: id, editorMode: "template", workspaceMode: "create",
      modelId: "historical-model", aspectRatio: template.aspectRatio, duration: 5, useReferenceImage: false,
      referenceImage: { id: "historical-reference" }, templateDrafts: { [id]: value } };
    const restored = draft.restoreGenerationWorkspaceDraft(saved)!;
    assert.equal(restored.editorMode, "template");
    assert.equal(restored.prompt, prompt);
    assert.deepEqual(restored.templateDrafts[id], value);
    assert.deepEqual(restored.referenceImage, saved.referenceImage);
    assert.equal(restored.useReferenceImage, false);
    assert.ok(!filterGenerationTemplates({ kind: "video" }).includes(template));
  }
});

test("empty filters retain the exact input list and all filtering keeps order and item references", () => {
  const list = Object.freeze([getGenerationTemplate("character-avatar")!, getGenerationTemplate("product-image")!, getGenerationTemplate("character-portrait")!]);
  const before = structuredClone(list);
  for (const query of ["", " \n\t", "\u3000\u00a0"]) {
    assert.equal(filterGenerationTemplates({ query }, list), list);
    assert.equal(filterGenerationTemplates({ query, kind: "all", category: "all" }, list), list);
  }
  const result = filterGenerationTemplates({ category: "character" }, list);
  assert.deepEqual(result.map(template => template.id), ["character-avatar", "character-portrait"]);
  assert.equal(result[0], list[0]); assert.equal(result[1], list[2]);
  assert.deepEqual(list, before);
});

test("editable defaults are separate copies and never inferred from placeholder text", () => {
  const template = getGenerationTemplate("character-avatar")!;
  const first = getGenerationTemplateDefaults(template)!;
  const second = getGenerationTemplateDefaults(template.id)!;
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first, template.defaultValues);
  first.subject = "穿黄雨衣的成年地图保管员";
  assert.notEqual(second.subject, first.subject);
  assert.notEqual(template.defaultValues.subject, first.subject);
  assert.match(fillGenerationTemplate(template, first), /成年地图保管员/);
  const changedPlaceholder: GenerationTemplate = { ...template,
    fields: template.fields.map(field => ({ ...field, placeholder: "THIS_IS_A_HINT_ONLY" })) };
  assert.deepEqual(getGenerationTemplateDefaults(changedPlaceholder), second);
  assert.throws(() => fillGenerationTemplate(template, {}), /每个字段/);
});

test("missing, unknown and malicious IDs or filter categories cannot select a template", () => {
  for (const id of [undefined, null, "", "unknown", "__proto__", "constructor", "toString", "<script>alert(1)</script>", "character-avatar "]) {
    assert.equal(getGenerationTemplate(id), null);
    assert.equal(getGenerationTemplateDefaults(id), null);
    assert.equal(isGenerationTemplateCategory(id), false);
  }
  for (const category of ["unknown", "__proto__", "constructor", "<img onerror=alert(1)>"]) {
    assert.equal(getGenerationTemplateCategory(category as Parameters<typeof getGenerationTemplateCategory>[0]), null);
    assert.deepEqual(filterGenerationTemplates({ category } as unknown as GenerationTemplateFilters), []);
  }
  assert.deepEqual(filterGenerationTemplates({ kind: "image-to-video" } as unknown as GenerationTemplateFilters), []);
  assert.deepEqual(filterGenerationTemplates({ query: "<script>alert(1)</script>" }), []);
});

test("fill still requires every value, preserves literal user fragments and enforces the prompt bound", () => {
  const template = getGenerationTemplate("character-portrait")!;
  const prompt = fillGenerationTemplate(template, { subject: "  $& 海港旅人 {{style}}  ", style: " 水彩 " });
  assert.match(prompt, /\$& 海港旅人 \{\{style\}\}/);
  assert.match(prompt, /画面风格：水彩/);
  assert.throws(() => fillGenerationTemplate(template, { subject: "旅人", style: " \n " }), /每个字段/);
  assert.throws(() => fillGenerationTemplate(template, { subject: "旅".repeat(4000), style: "水彩" }), /过长/);
});
