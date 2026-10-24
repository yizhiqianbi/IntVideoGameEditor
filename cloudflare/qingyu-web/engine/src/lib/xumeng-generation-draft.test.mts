import assert from "node:assert/strict";
import test from "node:test";
import * as draftExports from "./xumeng-generation-draft.ts";
import * as templateExports from "./xumeng-generation-templates.ts";
const draft = (draftExports as typeof draftExports & { default?: typeof draftExports }).default ?? draftExports;
const templates = (templateExports as typeof templateExports & { default?: typeof templateExports }).default ?? templateExports;
const template = templates.getGenerationTemplate("character-portrait")!;
const initial = () => draft.createGenerationTemplateDraft(template);
const raw = () => { const fields = initial(); return { schemaVersion: 2, kind: "image", prompt: draft.compileGenerationTemplateDraft(template, fields), templateId: template.id,
  editorMode: "template", workspaceMode: "create", modelId: "image-model", aspectRatio: "3:4", duration: 5,
  useReferenceImage: true, referenceImage: { id: "saved-reference" }, templateDrafts: { [template.id]: fields } }; };

test("structured edits deterministically compile with supplementary requirements and preserve literal fragments", () => {
  const first = initial(), second = initial();
  first.values.subject = "$& 成年地图员 {{style}}";
  first.additionalRequirements = "  铜色罗盘，保持暖光。  ";
  const compiled = draft.compileGenerationTemplateDraft(template, first);
  assert.match(compiled, /\$& 成年地图员 \{\{style\}\}/);
  assert.match(compiled, /\n补充要求：铜色罗盘，保持暖光。$/);
  assert.equal(draft.compileGenerationTemplateDraft(template, structuredClone(first)), compiled);
  assert.notEqual(first.values.subject, second.values.subject);
  assert.notEqual(first.values.subject, template.defaultValues.subject);
});

test("empty required parameters, field and compiled bounds, and unsafe controls cannot reach a generation input", () => {
  const value = initial();
  value.values.subject = " \n ";
  assert.throws(() => draft.compileGenerationTemplateDraft(template, value), /每个字段/);
  value.values.subject = "人".repeat(1001);
  assert.throws(() => draft.compileGenerationTemplateDraft(template, value), /1,000/);
  value.values.subject = "成年旅人\x00";
  assert.throws(() => draft.compileGenerationTemplateDraft(template, value), /控制字符/);
  const cover = templates.getGenerationTemplate("novel-cover")!;
  const long = draft.createGenerationTemplateDraft(cover);
  for (const field of cover.fields) long.values[field.id] = "字".repeat(1000);
  long.additionalRequirements = "字".repeat(1000);
  assert.throws(() => draft.compileGenerationTemplateDraft(cover, long), /过长/);
});

test("version 2 restores editable parameters, exact compiler snapshot, mode and private reference identity", () => {
  const value = raw();
  const restored = draft.restoreGenerationWorkspaceDraft(value)!;
  assert.equal(restored.editorMode, "template");
  assert.equal(restored.prompt, value.prompt);
  assert.deepEqual(restored.templateDrafts, value.templateDrafts);
  assert.deepEqual(restored.referenceImage, value.referenceImage);
  assert.equal(restored.useReferenceImage, true);
  assert.equal(restored.workspaceMode, "create");
  const unfinished = raw(); unfinished.templateDrafts[template.id].values.subject = ""; unfinished.prompt = "";
  assert.equal(draft.restoreGenerationWorkspaceDraft(unfinished)!.editorMode, "template");
  assert.equal(draft.restoreGenerationWorkspaceDraft({ schemaVersion: 2, kind: "image", prompt: "", templateId: "", editorMode: "template" })!.editorMode, "template");
  assert.equal(draft.restoreGenerationWorkspaceDraft({ schemaVersion: 2, kind: "image", prompt: "", templateId: "", editorMode: "legacy" })!.editorMode, "legacy");
});

test("old and hand-edited main prompts survive unchanged while old library drafts only populate later template choices", () => {
  const legacyPrompt = "  保留我改过的画面！\n{{subject}} $&  ";
  const libraryValues = { ...initial().values, subject: "成年森林测绘员" };
  const restored = draft.restoreGenerationWorkspaceDraft({ kind: "image", prompt: legacyPrompt, templateId: template.id,
    aspectRatio: "16:9", workspaceMode: "create" }, { drafts: { [template.id]: libraryValues } })!;
  assert.equal(restored.editorMode, "legacy"); assert.equal(restored.prompt, legacyPrompt);
  assert.deepEqual(restored.templateDrafts[template.id], { values: libraryValues, additionalRequirements: "" });
  assert.equal(restored.aspectRatio, "16:9");
  const manual = raw(); manual.prompt = legacyPrompt;
  assert.equal(draft.restoreGenerationWorkspaceDraft(manual)!.editorMode, "legacy");
  assert.equal(draft.restoreGenerationWorkspaceDraft(manual)!.prompt, legacyPrompt);
});

test("a saved h3 description stays on the h3 template after the catalog prompt changes", () => {
  const facial = templates.getGenerationTemplate("h3-facial")!;
  const fields = draft.createGenerationTemplateDraft(facial);
  const oldPrompt = "以用户上传的参考图作为起始画面。图中人物都是自愿的成年人，保持各自面部、发型和体型，不把人物换成别人。动作：她仰头看向镜头，精液射在她脸上。一个连贯镜头，不要字幕或水印。\n补充要求：把视频中女性替换为提供的参考图的女性";
  const restored = draft.restoreGenerationWorkspaceDraft({
    schemaVersion: 2, kind: "video", prompt: oldPrompt, templateId: "h3-facial",
    editorMode: "legacy", workspaceMode: "create", templateDrafts: { "h3-facial": fields },
  })!;
  assert.equal(restored.editorMode, "template");
  assert.equal(restored.templateDrafts["h3-facial"].additionalRequirements, "把视频中女性替换为提供的参考图的女性");
  const compiled = draft.compileGenerationTemplateDraft(facial, restored.templateDrafts["h3-facial"]);
  assert.match(compiled, /替换模板里原来的人/);
  assert.match(compiled, /补充要求：把视频中女性替换为提供的参考图的女性/);
  assert.doesNotMatch(compiled, /起始画面/);
});

test("unknown, kind-mismatched, malformed or changed template drafts preserve the main text as legacy", () => {
  for (const patch of [{ templateId: "unknown-template" }, { templateId: "story-opening" }, { templateDrafts: {} },
    { templateDrafts: { [template.id]: { values: { subject: "only one field" }, additionalRequirements: "" } } },
    { prompt: `${raw().prompt} changed template snapshot` }]) {
    const value = { ...raw(), ...patch };
    const restored = draft.restoreGenerationWorkspaceDraft(value)!;
    assert.equal(restored.editorMode, "legacy"); assert.equal(restored.prompt, value.prompt);
  }
  assert.equal(draft.restoreGenerationWorkspaceDraft({ kind: "image", prompt: "字".repeat(4001) }), null);
  assert.equal(draft.restoreGenerationWorkspaceDraft([]), null);
});

test("main parameter drafts win over library edits and only allowed bounded catalog fields are imported", () => {
  const own = initial(); own.values.subject = "我的主稿";
  const imported = { ...initial().values, subject: "旧库草稿", arbitrary: "not a prompt fragment" };
  const restored = draft.restoreGenerationTemplateDrafts({ [template.id]: own }, { drafts: { [template.id]: imported, unknown: imported } });
  assert.deepEqual(restored[template.id], own); assert.equal(Object.keys(restored).length, 1);
  const fromLibrary = draft.restoreGenerationTemplateDrafts(null, { drafts: { [template.id]: imported } });
  assert.equal(fromLibrary[template.id].values.subject, "旧库草稿");
  assert.equal("arbitrary" in fromLibrary[template.id].values, false);
  assert.deepEqual(draft.restoreGenerationTemplateDrafts(null, { drafts: { [template.id]: { ...imported, style: "字".repeat(1001) } } }), {});
});
