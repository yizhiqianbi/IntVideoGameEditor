import raw from "../data/channel-modules.json";

export type FieldKind = "text" | "prompt" | "image" | "images" | "video" | "audio" | "file";
export type ResultKind = "image" | "video" | "audio" | "text";

export type ChannelField = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
};

export type ChannelModule = {
  id: string;
  group: string;
  title: string;
  path: string;
  result: ResultKind;
  fields: ChannelField[];
};

export const CHANNEL_GROUPS = ["生图", "生视频", "视频处理", "人像", "漫剧", "语音", "文本", "其他"] as const;

const RETIRED = new Set([
  "tushengtu_jubu_tuya",
  "image_upscale-seedvr2_vosr2",
  "heibai_zhaoxiufu",
  "huanzhuang",
  "generate-clothes-swap-images",
  "generate-clothes-swap-video",
  "shipin_huanyi",
  "generate-kiss-video",
  "generate-subtitle",
  "generate-subtitle-translate",
  "generate-subtitle-render",
  "video_concat-5_clips",
  "ai_chuangzao_chaoqing_fangda",
  "ai_chuangzao_chaoqing_fangda_vosr2",
  "video_frame_interpolation-gimm_vfi",
]);

const FIELD_KINDS = new Set<FieldKind>(["text", "prompt", "image", "images", "video", "audio", "file"]);
const RESULTS = new Set<ResultKind>(["image", "video", "audio", "text"]);

function load(value: unknown): ChannelModule[] {
  if (!Array.isArray(value)) return [];
  const modules: ChannelModule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const group = typeof row.group === "string" ? row.group : "";
    const title = typeof row.title === "string" ? row.title : "";
    const path = typeof row.path === "string" ? row.path : "";
    const result = row.result;
    if (!id || RETIRED.has(id) || !group || !title || !path.startsWith("/api/public/") || typeof result !== "string" || !RESULTS.has(result as ResultKind)) continue;
    if (!Array.isArray(row.fields)) continue;
    const fields: ChannelField[] = [];
    for (const field of row.fields) {
      if (!field || typeof field !== "object") continue;
      const entry = field as Record<string, unknown>;
      const key = typeof entry.key === "string" ? entry.key : "";
      const label = typeof entry.label === "string" ? entry.label : "";
      const kind = entry.kind;
      if (!key || !label || typeof kind !== "string" || !FIELD_KINDS.has(kind as FieldKind) || typeof entry.required !== "boolean") continue;
      fields.push({ key, label, kind: kind as FieldKind, required: entry.required });
    }
    if (!fields.length) continue;
    modules.push({ id, group, title, path, result: result as ResultKind, fields });
  }
  return modules;
}

export const CHANNEL_MODULES: readonly ChannelModule[] = load(raw);

export function findChannelModule(id: string): ChannelModule | undefined {
  return CHANNEL_MODULES.find(item => item.id === id);
}
