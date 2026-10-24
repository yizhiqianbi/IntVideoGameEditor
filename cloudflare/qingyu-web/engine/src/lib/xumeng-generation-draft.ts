import type { GenerationKind } from "./xumeng-generation";
import { GENERATION_TEMPLATES, fillGenerationTemplate, getGenerationTemplate, getGenerationTemplateDefaults,
  type GenerationTemplate } from "./xumeng-generation-templates";

export const GENERATION_TEMPLATE_FIELD_LIMIT = 1000;
export type GenerationTemplateDraft = { values: Record<string, string>; additionalRequirements: string };
export type GenerationTemplateDrafts = Record<string, GenerationTemplateDraft>;
export type GenerationWorkspaceDraft = {
  schemaVersion: 2; kind: GenerationKind; prompt: string; modelId: string; aspectRatio: string; duration: number;
  templateId: string; editorMode: "template" | "legacy"; workspaceMode: "templates" | "create";
  templateDrafts: GenerationTemplateDrafts; useReferenceImage: boolean; referenceImage?: unknown;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= GENERATION_TEMPLATE_FIELD_LIMIT;
const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export function createGenerationTemplateDraft(template: GenerationTemplate): GenerationTemplateDraft {
  return { values: getGenerationTemplateDefaults(template) ?? {}, additionalRequirements: "" };
}

/** Restore only catalog fields. Missing/oversize values never silently become example text. */
function readTemplateDraft(template: GenerationTemplate, raw: unknown, legacy = false): GenerationTemplateDraft | null {
  if (!object(raw)) return null;
  const values = legacy ? raw : raw.values;
  if (!object(values) || template.fields.some(field => !text(values[field.id]))) return null;
  const additional = legacy ? "" : raw.additionalRequirements;
  if (!text(additional)) return null;
  return { values: Object.fromEntries(template.fields.map(field => [field.id, values[field.id] as string])), additionalRequirements: additional };
}

/** Old library drafts supply editable parameters only; they cannot replace a saved main prompt. */
export function restoreGenerationTemplateDrafts(main: unknown, library: unknown): GenerationTemplateDrafts {
  const result: GenerationTemplateDrafts = {};
  const legacy = object(library) && object(library.drafts) ? library.drafts : null;
  for (const template of GENERATION_TEMPLATES) {
    const restored = object(main) ? readTemplateDraft(template, main[template.id]) : null;
    const imported = legacy ? readTemplateDraft(template, legacy[template.id], true) : null;
    if (restored || imported) result[template.id] = restored ?? imported!;
  }
  return result;
}

export function compileGenerationTemplateDraft(template: GenerationTemplate, draft: GenerationTemplateDraft): string {
  if (template.fields.some(field => !text(draft.values[field.id])) || !text(draft.additionalRequirements)) {
    throw new Error("每项参数最多 1,000 字，请缩短后重试。");
  }
  if (template.fields.some(field => controls.test(draft.values[field.id])) || controls.test(draft.additionalRequirements)) {
    throw new Error("参数包含无法使用的控制字符，请检查后重试。");
  }
  const base = fillGenerationTemplate(template, draft.values);
  const result = draft.additionalRequirements.trim() ? `${base}\n补充要求：${draft.additionalRequirements.trim()}` : base;
  if (result.length > 4000) throw new Error("模板内容过长，请缩短参数或补充要求后重试。");
  return result;
}

export function restoreGenerationWorkspaceDraft(raw: unknown, library?: unknown): GenerationWorkspaceDraft | null {
  if (!object(raw) || !["image", "video"].includes(raw.kind as string) || typeof raw.prompt !== "string" || raw.prompt.length > 4000) return null;
  const kind = raw.kind as GenerationKind;
  const templateDrafts = restoreGenerationTemplateDrafts(raw.templateDrafts, library);
  const templateId = typeof raw.templateId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(raw.templateId) ? raw.templateId : "";
  const template = getGenerationTemplate(templateId);
  const connected = Boolean(template && template.kind === kind && !template.archived && (template.id.startsWith("h3-") || template.krea2Lora));
  if (connected && template && !templateDrafts[templateId]) templateDrafts[templateId] = createGenerationTemplateDraft(template);
  if (connected && templateDrafts[templateId] && !templateDrafts[templateId].additionalRequirements.trim()) {
    const marker = "补充要求：";
    const at = raw.prompt.lastIndexOf(marker);
    const extra = at >= 0 ? raw.prompt.slice(at + marker.length).trim() : "";
    if (extra && extra.length <= GENERATION_TEMPLATE_FIELD_LIMIT && !controls.test(extra)) {
      templateDrafts[templateId] = { ...templateDrafts[templateId], additionalRequirements: extra };
    }
  }
  let editorMode: "template" | "legacy" = raw.prompt === "" && !templateId && raw.editorMode !== "legacy" ? "template" : "legacy";
  if (connected && templateDrafts[templateId]) editorMode = "template";
  else if (raw.schemaVersion === 2 && raw.editorMode === "template" && template?.kind === kind && templateDrafts[templateId]) {
    // The saved prompt is a compiler snapshot. A catalog change or a formerly
    // hand-edited prompt falls back to its exact text instead of being rewritten.
    try { if (compileGenerationTemplateDraft(template, templateDrafts[templateId]) === raw.prompt) editorMode = "template"; }
    catch { if (raw.prompt === "") editorMode = "template"; }
  }
  return { schemaVersion: 2, kind, prompt: raw.prompt, templateId, editorMode, templateDrafts,
    modelId: typeof raw.modelId === "string" && raw.modelId.length <= 100 ? raw.modelId : "",
    aspectRatio: typeof raw.aspectRatio === "string" && raw.aspectRatio.length <= 10 ? raw.aspectRatio : "1:1",
    duration: Number.isInteger(raw.duration) && Number(raw.duration) >= 1 && Number(raw.duration) <= 30 ? Number(raw.duration) : 5,
    workspaceMode: raw.workspaceMode === "create" || (!raw.workspaceMode && raw.prompt.trim()) ? "create" : "templates",
    useReferenceImage: raw.useReferenceImage === true, ...(raw.referenceImage ? { referenceImage: raw.referenceImage } : {}) };
}
