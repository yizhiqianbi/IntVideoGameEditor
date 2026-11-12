import { IMAGE_GROUPS, IMAGE_TEMPLATES, VIDEO_TEMPLATES, assetOrigin, imageTemplate, videoTemplate, type ImageTemplate } from "./catalog";
import { customImage, customImageBytes, customImages } from "./custom-templates";
import { adminImageFields, adminVideoFields, localCover } from "./live-edits";

export type TemplateRow = {
  id: string;
  label: string;
  group: string;
  groupLabel: string;
  kind: "image" | "video";
  source: "library" | "upload";
  content: string;
  prompt: string;
  listed: boolean;
  cover: string;
};

const GROUP_LABELS = new Map(IMAGE_GROUPS.map(item => [item.id, item.label]));

function imageRow(item: ImageTemplate, source: "library" | "upload"): TemplateRow {
  const live = adminImageFields(item, source);
  return {
    id: item.id,
    label: live.label,
    group: live.group,
    groupLabel: GROUP_LABELS.get(live.group) ?? live.group,
    kind: "image",
    source,
    content: live.frame,
    prompt: live.prompt,
    listed: live.listed,
    cover: live.cover,
  };
}

export function templateRows(): { groups: { id: string; label: string }[]; templates: TemplateRow[] } {
  const images: TemplateRow[] = [
    ...customImages().map(item => imageRow(item, "upload")),
    ...IMAGE_TEMPLATES.map(item => imageRow(item, "library")),
  ];
  const videos: TemplateRow[] = VIDEO_TEMPLATES.map(item => {
    const live = adminVideoFields(item);
    return {
      id: item.id,
      label: live.label,
      group: "",
      groupLabel: "动作",
      kind: "video" as const,
      source: "library" as const,
      content: live.description,
      prompt: live.action,
      listed: live.listed,
      cover: live.cover,
    };
  });
  return { groups: IMAGE_GROUPS.map(item => ({ id: item.id, label: item.label })), templates: [...images, ...videos] };
}

export function templateCatalog() {
  return {
    images: [
      ...customImages().map(item => {
        const live = adminImageFields(item, "upload");
        return { id: item.id, label: live.label, group: live.group, aspectRatio: live.aspectRatio, frame: live.frame, prompt: live.prompt, listed: live.listed, source: "upload" as const };
      }),
      ...IMAGE_TEMPLATES.map(item => {
        const live = adminImageFields(item, "library");
        return { id: item.id, label: live.label, group: live.group, aspectRatio: live.aspectRatio, frame: live.frame, prompt: live.prompt, listed: live.listed, source: "library" as const };
      }),
    ],
    videos: VIDEO_TEMPLATES.map(item => {
      const live = adminVideoFields(item);
      return { id: item.id, label: live.label, description: live.description, action: live.action, listed: live.listed, source: "library" as const };
    }),
  };
}

function attachment(filename: string): string {
  const safe = filename.replace(/[\r\n"]/g, "").slice(0, 80) || "template";
  const ascii = safe.replace(/[^\w.-]+/g, "_").slice(0, 80) || "template";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function templateFile(id: string, kind: string): Promise<{ body: BodyInit; type: string; filename: string } | null> {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  if (kind === "image" && id.startsWith("custom-")) {
    const item = customImage(id);
    const file = item ? customImageBytes(item) : null;
    if (!item || !file) return null;
    return { body: new Uint8Array(file.bytes), type: file.type, filename: `${item.label}.${item.ext}` };
  }
  if (kind === "image") {
    const cover = localCover("image", id);
    const item = imageTemplate(id);
    if (cover && item) {
      const ext = cover.type === "image/jpeg" ? "jpg" : cover.type === "image/png" ? "png" : "webp";
      return { body: new Uint8Array(cover.bytes), type: cover.type, filename: `${item.label}.${ext}` };
    }
    if (!item) return null;
    const remote = await fetch(`${assetOrigin()}/assets/xumeng/krea2-actions/${encodeURIComponent(item.id)}.webp`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const type = remote.headers.get("content-type") ?? "";
    if (!remote.ok || !remote.body || !type.startsWith("image/")) return null;
    return { body: remote.body, type: "image/webp", filename: `${item.label}.webp` };
  }
  if (kind === "video") {
    const item = videoTemplate(id);
    if (!item) return null;
    const remote = await fetch(`${assetOrigin()}/assets/xumeng/h3-actions/${encodeURIComponent(item.id)}.mp4`, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const type = remote.headers.get("content-type") ?? "";
    if (!remote.ok || !remote.body || (!type.startsWith("video/") && !type.includes("octet-stream"))) return null;
    return { body: remote.body, type: "video/mp4", filename: `${item.label}.mp4` };
  }
  return null;
}

export function downloadHeaders(type: string, filename: string): HeadersInit {
  return {
    "Content-Type": type,
    "Content-Disposition": attachment(filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
