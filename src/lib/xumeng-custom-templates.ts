import type { GenerationKind } from "./xumeng-generation";
import { registerCustomGenerationTemplates, type GenerationTemplate } from "./xumeng-generation-templates";

export const CUSTOM_TEMPLATE_ASPECT_RATIOS = ["3:4", "9:16", "1:1", "4:3", "16:9"] as const;
export type CustomTemplateAspectRatio = typeof CUSTOM_TEMPLATE_ASPECT_RATIOS[number];

export type CustomGenerationTemplateItem = {
  id: string;
  kind: GenerationKind;
  label: string;
  englishLabel: string;
  description: string;
  groupLabel: string;
  tags: string[];
  aspectRatio: string;
  promptPattern: string;
  demoPosterUrl: string | null;
  demoVideoUrl: string | null;
  sortOrder: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export function isCustomTemplateAspectRatio(value: unknown): value is CustomTemplateAspectRatio {
  return typeof value === "string" && (CUSTOM_TEMPLATE_ASPECT_RATIOS as readonly string[]).includes(value);
}

export function customTemplateToGenerationTemplate(item: CustomGenerationTemplateItem): GenerationTemplate {
  const hasKeywords = item.promptPattern.includes("{{keywords}}");
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    englishLabel: item.englishLabel || item.label,
    description: item.description || (item.kind === "video" ? "后台自定义视频动作模板" : "后台自定义图片风格模板"),
    categories: ["character"],
    tags: Array.from(new Set([...item.tags, item.groupLabel, item.kind === "video" ? "视频" : "图片"].filter(Boolean))),
    aspectRatio: item.aspectRatio || (item.kind === "video" ? "9:16" : "3:4"),
    fields: hasKeywords
      ? [{ id: "keywords", label: "补充关键词", placeholder: "可选：补充动作、服装、环境或光线细节", description: "将替换模板提示词中的 {{keywords}} 占位符。", optional: true }]
      : [],
    defaultValues: hasKeywords ? { keywords: "" } : {},
    pattern: item.promptPattern,
    ...(item.demoPosterUrl ? { demoPosterUrl: item.demoPosterUrl } : {}),
    ...(item.demoVideoUrl ? { demoVideoUrl: item.demoVideoUrl } : {}),
    customTemplate: true,
    customGroup: item.groupLabel || "自定义精选",
  };
}

function parseItem(value: unknown): CustomGenerationTemplateItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || (r.kind !== "image" && r.kind !== "video")) return null;
  if (typeof r.label !== "string" || !r.label.trim() || typeof r.promptPattern !== "string" || !r.promptPattern.trim()) return null;
  return {
    id: r.id,
    kind: r.kind,
    label: r.label.trim(),
    englishLabel: typeof r.englishLabel === "string" ? r.englishLabel : "",
    description: typeof r.description === "string" ? r.description : "",
    groupLabel: typeof r.groupLabel === "string" && r.groupLabel.trim() ? r.groupLabel.trim() : "自定义精选",
    tags: Array.isArray(r.tags) ? r.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).slice(0, 12) : [],
    aspectRatio: typeof r.aspectRatio === "string" && r.aspectRatio.trim() ? r.aspectRatio.trim() : (r.kind === "video" ? "9:16" : "3:4"),
    promptPattern: r.promptPattern,
    demoPosterUrl: typeof r.demoPosterUrl === "string" && r.demoPosterUrl ? r.demoPosterUrl : null,
    demoVideoUrl: typeof r.demoVideoUrl === "string" && r.demoVideoUrl ? r.demoVideoUrl : null,
    sortOrder: typeof r.sortOrder === "number" && Number.isFinite(r.sortOrder) ? r.sortOrder : 100,
    enabled: r.enabled !== false,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
  };
}

let cachedTemplates: GenerationTemplate[] | null = null;
let inflight: Promise<GenerationTemplate[]> | null = null;
const listeners = new Set<(templates: readonly GenerationTemplate[]) => void>();

function notify(list: GenerationTemplate[]) {
  cachedTemplates = list;
  registerCustomGenerationTemplates(list);
  for (const listener of listeners) listener(list);
}

export function subscribeCustomGenerationTemplates(listener: (templates: readonly GenerationTemplate[]) => void): () => void {
  listeners.add(listener);
  if (cachedTemplates) listener(cachedTemplates);
  return () => { listeners.delete(listener); };
}

export function invalidateCustomGenerationTemplatesCache(): void {
  cachedTemplates = null;
  inflight = null;
}

export async function loadPublicCustomGenerationTemplates(force = false): Promise<readonly GenerationTemplate[]> {
  if (!force && cachedTemplates) return cachedTemplates;
  if (!force && inflight) return inflight;
  inflight = fetch("/api/backend/v1/generation-templates", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
    .then(async response => {
      if (!response.ok) return [] as GenerationTemplate[];
      const data: unknown = await response.json().catch(() => null);
      const rawList = data && typeof data === "object" && Array.isArray((data as { templates?: unknown }).templates)
        ? (data as { templates: unknown[] }).templates
        : [];
      const converted = rawList
        .map(parseItem)
        .filter((item): item is CustomGenerationTemplateItem => item !== null && item.enabled)
        .map(customTemplateToGenerationTemplate);
      notify(converted);
      return converted;
    })
    .catch(() => cachedTemplates ?? [])
    .finally(() => { inflight = null; });
  return inflight;
}
