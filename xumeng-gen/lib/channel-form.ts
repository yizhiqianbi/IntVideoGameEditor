import { noteError } from "./catalog";
import { AiapiError, aiapiPublicUrl, type AiapiRequest } from "./aiapi-channel";
import type { ChannelModule } from "./channel-catalog";

const ADULT_KEYS = new Set(["positive_prompt", "prompt", "text", "description", "plot_direction", "details"]);

function httpsValue(label: string, value: string): string {
  const trimmed = value.trim();
  if (!aiapiPublicUrl(trimmed)) throw new AiapiError(`${label}需要是 https 链接。`, 400);
  return trimmed;
}

export function moduleForm(module: ChannelModule, values: Record<string, string>, taskId: string): { form: URLSearchParams; inputs: string[] } {
  const form = new URLSearchParams();
  form.set("task_id", taskId);
  const inputs: string[] = [];
  for (const field of module.fields) {
    let value = (values[field.key] ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
    if (!value) {
      if (field.required) throw new AiapiError(`请填写${field.label}。`, 400);
      continue;
    }
    if (field.kind === "prompt" || field.kind === "text") {
      const rejected = noteError(value);
      if (rejected) throw new AiapiError(rejected, 400);
      if ((module.result === "image" || module.result === "video") && ADULT_KEYS.has(field.key) && !value.includes("二十一岁")) {
        value = `${value}。虚构的成年角色，二十一岁以上。`;
      }
      value = value.slice(0, 4000);
    } else if (field.kind === "images") {
      let urls: string[] = [];
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) urls = parsed.filter((item): item is string => typeof item === "string");
      } catch {
        urls = [];
      }
      if (urls.length < 1 || urls.length > 9 || urls.some(url => !aiapiPublicUrl(url.trim()))) {
        throw new AiapiError("参考图需要 1 到 9 个 https 链接。", 400);
      }
      const clean = urls.map(url => url.trim());
      inputs.push(...clean);
      if (module.path === "/api/public/minimax/h3_i2v_reference") {
        for (const url of clean) form.append(field.key, url);
        continue;
      }
      value = JSON.stringify(clean);
    } else if (field.kind === "image" || field.kind === "video" || field.kind === "audio" || field.kind === "file") {
      value = httpsValue(field.label, value);
      inputs.push(value);
    }
    form.set(field.key, value);
  }
  if (module.result === "video") form.set("video_format", "video/h264-mp4");
  return { form, inputs };
}

export function moduleRequest(module: ChannelModule, values: Record<string, string>, taskId: string): AiapiRequest {
  const { form, inputs } = moduleForm(module, values, taskId);
  const timeoutMs = module.result === "video" ? 280_000 : module.result === "image" ? 220_000 : 180_000;
  return { path: module.path, form, kind: module.result, inputs, timeoutMs };
}
