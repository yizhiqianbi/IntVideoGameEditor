export interface TemplateBridgeCharacter {
  id: string;
  name: string;
  coverUrl: string;
}

export interface PendingAigenTemplate {
  id: string;
  label: string;
  kind: "image" | "video";
  prompt: string;
  demoPosterUrl?: string;
  demoVideoUrl?: string;
}

const ROLE_KEY = "xumeng:template-bridge:role:v1";
const TEMPLATE_KEY = "xumeng:template-bridge:template:v1";
const AIGEN_TEMPLATE_KEY = "xumeng:template-bridge:aigen-template:v1";

export function setTemplateBridgeCharacter(character: TemplateBridgeCharacter | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!character || !character.coverUrl) {
      window.sessionStorage.removeItem(ROLE_KEY);
      return;
    }
    window.sessionStorage.setItem(ROLE_KEY, JSON.stringify(character));
  } catch {
    // Ignore storage failures.
  }
}

export function readTemplateBridgeCharacter(): TemplateBridgeCharacter | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ROLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TemplateBridgeCharacter> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.name !== "string" || typeof parsed.coverUrl !== "string") {
      return null;
    }
    return { id: parsed.id, name: parsed.name, coverUrl: parsed.coverUrl };
  } catch {
    return null;
  }
}

export function setPendingGenerationTemplateId(templateId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!templateId) window.sessionStorage.removeItem(TEMPLATE_KEY);
    else window.sessionStorage.setItem(TEMPLATE_KEY, templateId);
  } catch {
    // Ignore storage failures.
  }
}

export function consumePendingGenerationTemplateId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.sessionStorage.getItem(TEMPLATE_KEY);
    if (id) window.sessionStorage.removeItem(TEMPLATE_KEY);
    return id || null;
  } catch {
    return null;
  }
}

export function setPendingAigenTemplate(template: PendingAigenTemplate | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!template) window.sessionStorage.removeItem(AIGEN_TEMPLATE_KEY);
    else window.sessionStorage.setItem(AIGEN_TEMPLATE_KEY, JSON.stringify(template));
  } catch {
    // Ignore storage failures.
  }
}

export function consumePendingAigenTemplate(): PendingAigenTemplate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AIGEN_TEMPLATE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(AIGEN_TEMPLATE_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingAigenTemplate> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.label !== "string" || (parsed.kind !== "image" && parsed.kind !== "video")) {
      return null;
    }
    return {
      id: parsed.id,
      label: parsed.label,
      kind: parsed.kind,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      demoPosterUrl: typeof parsed.demoPosterUrl === "string" ? parsed.demoPosterUrl : undefined,
      demoVideoUrl: typeof parsed.demoVideoUrl === "string" ? parsed.demoVideoUrl : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches a character's cover portrait from same-origin / public asset URL and
 * wraps it as a standard browser File ready for `prepareReferenceImage()`.
 */
export async function fetchCoverAsReferenceFile(
  coverUrl: string,
  characterName: string,
  signal?: AbortSignal,
): Promise<File> {
  const response = await fetch(coverUrl, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`无法加载角色参考图 (${response.status})`);
  }
  const blob = await response.blob();
  const mime = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const safeName = (characterName || "character").replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 32);
  return new File([blob], `${safeName}.${ext}`, { type: mime });
}
