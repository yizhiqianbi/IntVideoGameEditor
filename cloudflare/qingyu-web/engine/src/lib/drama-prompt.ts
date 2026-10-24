import {
  DRAMA_PROMPT_LIMIT,
  SHOT_FIELD_LIMIT,
  type DramaMode,
  type Shot,
} from "./drama";
import type { AssetCard } from "./drama-assets";
import { orderedReferenceMedia, referenceSlots, syncReferenceBindings } from "./drama-mentions";
import {
  parseShotDuration,
  validateGpuModel,
  type GpuVideoModel,
} from "./drama-models";

export const SHOT_FIELD_DEFS = [
  {
    id: "start",
    label: "起始",
    hint: "前1–2秒锁定状态：姿势、服装、人物位置和道具"
  },
  {
    id: "action",
    label: "动作",
    hint: "中间唯一动作：运动方向、道具交互、重量与惯性"
  },
  {
    id: "camera",
    label: "镜头",
    hint: "一个景别 + 一种运镜，如中近景、固定带呼吸、缓慢推近"
  },
  {
    id: "setting",
    label: "场景",
    hint: "空间、道具、光线；可留空，使用已绑定场景卡",
  },
  {
    id: "sound",
    label: "声音",
    hint: "环境声与动作声；对白放引号里"
  },
  {
    id: "end",
    label: "结束",
    hint: "结束静止状态，供下一镜接入"
  },
] as const;

export type ShotFieldId = (typeof SHOT_FIELD_DEFS)[number]["id"];
export type ShotPromptFields = Partial<Record<ShotFieldId, string>>;

const SHOT_FIELD_LABELS = Object.fromEntries(
  SHOT_FIELD_DEFS.map((def) => [def.label, def.id]),
) as Record<string, ShotFieldId>;
const LABELED_SHOT_SOURCE = `^(${SHOT_FIELD_DEFS.map((def) => def.label).join("|")})：`;

export type DramaPromptSettings = {
  style: string;
  camera: string;
  lighting: string;
  audio: string;
  negative: string;
};

export const DEFAULT_PROMPT_SETTINGS: DramaPromptSettings = {
  style:
    "写实电影感，人物、服装与场景材质清楚，自然光线，浅景深，细胶片颗粒。无文字、无水印、无Logo。",
  camera: "中近景，固定机位带轻微手持呼吸，或单一缓慢推近。不要跳切，不要环绕炫技。",
  lighting: "自然主光与柔和轮廓光，保持人物和空间的光线连续，避免过度美颜。",
  audio: "保留环境、脚步与道具声；对白放在引号里，口型同步。",
  negative: "",
};

// Only replace former built-in defaults; preserve user-written project prompts.
const RETIRED_PROMPT_DEFAULTS: Partial<Record<keyof DramaPromptSettings, string[]>> = {
  style: [
    "写实电影感，皮肤与织物材质清楚，贴肤暖光，浅景深，细胶片颗粒。无文字、无水印、无Logo。",
    
  ],
  lighting: [
    "贴肤暖光，轮廓光分开两人，避免舞台灯和美颜磨皮。",
    "贴肤暖光，轮廓光分开两人，避免幼态和美颜磨皮。",
  ],
  audio: ["保留呼吸、织物、皮肤接触与床品声；对白短促并放在引号里，口型同步。"],
};

export function parsePromptSettings(value: unknown): DramaPromptSettings {
  const root =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: keyof DramaPromptSettings) =>
    typeof root[key] === "string" && !RETIRED_PROMPT_DEFAULTS[key]?.includes(root[key])
      ? root[key].slice(0, SHOT_FIELD_LIMIT)
      : DEFAULT_PROMPT_SETTINGS[key];
  return {
    style: text("style"),
    camera: text("camera"),
    lighting: text("lighting"),
    audio: text("audio"),
    negative: text("negative"),
  };
}

export type VideoPlan = {
  videoModel: GpuVideoModel;
  mode: DramaMode;
  duration: number;
  reason: string;
};

export type GpuHint = {
  ltx?: { ready?: boolean; t2v?: boolean; pinkcherry?: boolean };
};

function fieldCap(id: ShotFieldId | "action") {
  return id === "action" ? DRAMA_PROMPT_LIMIT : SHOT_FIELD_LIMIT;
}

export { parseShotDuration } from "./drama-models";

function asFieldRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickFieldText(records: Record<string, unknown>[], keys: string[]) {
  for (const record of records) {
    const map = new Map(
      Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
    );
    for (const key of keys) {
      const value = Object.prototype.hasOwnProperty.call(record, key)
        ? record[key]
        : map.get(key.toLowerCase());
      if (typeof value === "string" && value.trim())
        return value.trim();
    }
  }
  return "";
}

export function parsePromptFields(value: unknown): ShotPromptFields {
  const root = asFieldRecord(value);
  const nested = asFieldRecord(
    root.promptFields ?? root.prompt_fields ?? root.fields,
  );
  const sources = [root, nested];
  const fields: ShotPromptFields = {};
  for (const def of SHOT_FIELD_DEFS) {
    const text = pickFieldText(sources, [def.id, def.label]);
    if (text) fields[def.id] = text.slice(0, fieldCap(def.id));
  }
  if (!fields.action) {
    const fallback = pickFieldText(sources, [
      "prompt",
      "动作",
      "description",
      "content",
      "desc",
      "描述",
      "正文",
      "text",
      "body",
    ]);
    if (fallback) fields.action = fallback.slice(0, DRAMA_PROMPT_LIMIT);
  }
  return fields;
}

export function parseScriptShot(raw: unknown, index: number) {
  if (!raw || typeof raw !== "object") throw new Error("分镜描述格式无效");
  const fields = parsePromptFields(raw);
  const action = fields.action?.trim() || "";
  if (!action || action.length > DRAMA_PROMPT_LIMIT)
    throw new Error("分镜描述格式无效");
  const root = asFieldRecord(raw);
  const title = pickFieldText([root], ["title", "name", "镜头名"]);
  return {
    title: title ? title.slice(0, 120) : `镜头 ${index + 1}`,
    prompt: action,
    promptFields: { ...fields, action },
    duration: parseShotDuration(
      root.duration ?? root.Duration ?? root.seconds ?? root["时长"],
    ),
  };
}

export function labeledShotPrompt(
  shot: Pick<Shot, "prompt" | "promptFields">,
) {
  const fields = shot.promptFields || {};
  const action = (fields.action || shot.prompt || "").trim();
  const structured = SHOT_FIELD_DEFS.some(
    (def) => def.id !== "action" && fields[def.id]?.trim(),
  );
  if (!structured) return action;
  return [
    fields.start?.trim() && `起始：${fields.start.trim()}`,
    action && `动作：${action}`,
    fields.camera?.trim() && `镜头：${fields.camera.trim()}`,
    fields.setting?.trim() && `场景：${fields.setting.trim()}`,
    fields.sound?.trim() && `声音：${fields.sound.trim()}`,
    fields.end?.trim() && `结束：${fields.end.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeShotPrompt(
  shot: Pick<
    Shot,
    | "prompt"
    | "promptFields"
    | "duration"
    | "referenceMedia"
    | "referenceBindings"
  >,
  settings?: DramaPromptSettings,
) {
  const fields = shot.promptFields || {};
  const action = (fields.action || shot.prompt || "").trim();
  const start = fields.start?.trim() || "";
  const setting = fields.setting?.trim() || "";
  const end = fields.end?.trim() || "";
  const camera = fields.camera?.trim() || settings?.camera.trim() || "";
  const sound = fields.sound?.trim() || settings?.audio.trim() || "";
  const structured = SHOT_FIELD_DEFS.some(
    (def) => def.id !== "action" && fields[def.id]?.trim(),
  );
  const extras = [
    settings?.style.trim() && `风格：${settings.style.trim()}`,
    settings?.lighting.trim() && `光线：${settings.lighting.trim()}`,
  ].filter(Boolean);
  if (!structured && !extras.length && !camera && !sound) return action;
  const duration = parseShotDuration(shot.duration);
  const media = orderedReferenceMedia(shot);
  const audioNotes = media
    .filter((m) => m.prompt?.trim())
    .map((m) => {
      const n = media.filter((item) => item.kind === m.kind).indexOf(m) + 1;
      const label = m.kind === "audio" ? "Audio" : "Video";
      return `${label} ${n} 用法：${m.prompt!.trim()}`;
    });
  const timeline =
    start || end
      ? [
          "时间轴：",
          start &&
            `0–2秒：${start}。先站住，锁定姿势、衣着与距离，再开始动作。`,
          action && `中间：${action}`,
          end && `末1–2秒：${end}。停在这个静止状态，不要再开新动作。`,
        ]
      : action
        ? [`动作：${action}`]
        : [];
  return [
    `规格：${duration}秒 | 24fps | 写实连续单镜头。同一空间、连续时间、一条运镜；禁止内部切镜、跳切、蒙太奇和黑场。`,
    ...timeline,
    camera && `镜头：${camera}`,
    setting && `场景：${setting}`,
    sound && `声音：${sound}`,
    ...extras,
    ...audioNotes,
    "连续性：承接上一镜的动作、关系状态、光线和距离；本镜结束停在上述结束状态。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function visibleShotPrompt(
  shot: Pick<Shot, "prompt" | "promptFields">,
) {
  return labeledShotPrompt(shot);
}

export function parseLabeledShotPrompt(text: string): {
  prompt: string;
  promptFields: ShotPromptFields;
} {
  const source = text.slice(0, DRAMA_PROMPT_LIMIT);
  const matches = [...source.matchAll(new RegExp(LABELED_SHOT_SOURCE, "gm"))];
  if (!matches.length) {
    const action = source.trim();
    return {
      prompt: action,
      promptFields: action ? { action } : {},
    };
  }
  const fields: ShotPromptFields = {};
  const prefix = source.slice(0, matches[0].index ?? 0).trim();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const id = SHOT_FIELD_LABELS[match[1]];
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    const value = source
      .slice(start, end)
      .trim()
      .slice(0, id ? fieldCap(id) : SHOT_FIELD_LIMIT);
    if (id && value) fields[id] = value;
  }
  if (prefix)
    fields.action = [prefix, fields.action]
      .filter(Boolean)
      .join("\n")
      .slice(0, DRAMA_PROMPT_LIMIT);
  const action = (fields.action || "").slice(0, DRAMA_PROMPT_LIMIT);
  return { prompt: action, promptFields: fields };
}

export function bindableAssets(assets: AssetCard[]) {
  return assets.filter((a) => !/· (首帧|尾帧)$/.test(a.title));
}

function mentionedSources(shot: Shot, assets: AssetCard[]) {
  const slots = referenceSlots(shot, assets);
  const found = new Set<string>();
  const text = `${shot.prompt}\n${SHOT_FIELD_DEFS.map((def) => shot.promptFields?.[def.id] || "").join("\n")}`;
  for (const match of text.matchAll(/@(Image|Video|Audio)(\d+)\b/g)) {
    const token = `${match[1]}${match[2]}`;
    const source = shot.referenceBindings?.[token];
    const slot = source
      ? slots.find((item) => item.source === source)
      : slots.find((item) => item.token === token);
    if (slot) found.add(slot.source);
  }
  return found;
}

export function ensureMentions(shot: Shot, assets: AssetCard[]) {
  if (shot.mode === "i2v" || shot.videoModel === "ltx-10eros")
    return {
      prompt: shot.prompt,
      referenceBindings: shot.referenceBindings,
    };
  const bindings = syncReferenceBindings(shot, assets);
  const slots = referenceSlots({ ...shot, referenceBindings: bindings }, assets);
  if (!slots.length)
    return {
      prompt: shot.prompt.trim(),
      referenceBindings: Object.keys(bindings).length ? bindings : undefined,
    };
  const mentioned = mentionedSources({ ...shot, referenceBindings: bindings }, assets);
  const extras: string[] = [];
  for (const slot of slots) {
    if (!mentioned.has(slot.source)) extras.push(`@${slot.token}`);
  }
  let prompt = extras.length
    ? `${extras.join(" ")} ${shot.prompt}`.trim()
    : shot.prompt;
  for (const token of Object.keys(shot.referenceBindings || {})) {
    if (bindings[token]) continue;
    prompt = prompt.replace(new RegExp(`@${token}\\s*`, "g"), "");
  }
  return {
    prompt: prompt.trim(),
    referenceBindings: bindings,
  };
}

export function attachAssets(
  shot: Shot,
  assets: AssetCard[],
  extraIds: string[] = [],
): Shot {
  const known = new Set(assets.map((a) => a.id));
  const assetIds = Array.from(
    new Set([...(shot.assetIds || []), ...extraIds]),
  ).filter((id) => known.has(id));
  const next = { ...shot, assetIds };
  return { ...next, ...ensureMentions(next, assets) };
}

export function bindProjectAssets(shot: Shot, assets: AssetCard[]): Shot {
  return attachAssets(
    shot,
    assets,
    bindableAssets(assets).map((a) => a.id),
  );
}

export function unbindAsset(shot: Shot, assetId: string): Partial<Shot> {
  const source = `asset:${assetId}`;
  const bindings = Object.fromEntries(
    Object.entries(shot.referenceBindings || {}).filter(
      ([, value]) => value !== source,
    ),
  );
  const tokens = Object.entries(shot.referenceBindings || {})
    .filter(([, value]) => value === source)
    .map(([token]) => token);
  let prompt = shot.prompt;
  for (const token of tokens)
    prompt = prompt.replace(new RegExp(`@${token}\\s*`, "g"), "");
  return {
    assetIds: (shot.assetIds || []).filter((id) => id !== assetId),
    referenceBindings: bindings,
    prompt: prompt.replace(/\s+/g, " ").trim(),
  };
}

export function recommendVideoPlan(input: {
  tone?: string;
  duration?: number;
  firstFrame?: string;
  lastFrame?: string;
  mode?: DramaMode;
  videoModel?: GpuVideoModel;
  modelPick?: Shot["modelPick"];
  hasReferenceImages?: boolean;
  hasReferenceMedia?: boolean;
  hasReferenceAudio?: boolean;
  hasReferenceVideo?: boolean;
  gpu?: GpuHint;
}): VideoPlan {
  const duration = parseShotDuration(input.duration);
  const hasAudio = Boolean(input.hasReferenceAudio);
  const hasVideo = Boolean(input.hasReferenceVideo);
  const hasAV = Boolean(input.hasReferenceMedia) || hasAudio || hasVideo;
  if (input.modelPick === "manual" && input.videoModel) {
    const videoModel = validateGpuModel(input.videoModel);
    return {
      videoModel,
      mode:
        videoModel === "ltx-10eros"
          ? "i2v"
          : videoModel === "ltx-sulphur"
            ? "t2v"
            : input.mode || "t2v",
      duration,
      reason: "已按手动选择的模型生成。",
    };
  }
  if (hasAV)
    return {
      videoModel: "h3",
      mode: "ri2v",
      duration,
      reason: hasAudio && hasVideo
        ? "有视频和音频参考，使用 10Eros-Max 参考模式。"
        : hasAudio
          ? "有音频参考，使用 10Eros-Max 参考模式。"
          : hasVideo
            ? "有视频参考，使用 10Eros-Max 参考模式。"
            : "有视频或音频参考，使用 10Eros-Max 参考模式。",
    };
  if (input.lastFrame)
    return {
      videoModel: "h3",
      mode: "i2v",
      duration,
      reason: "有尾帧时使用 10Eros-Max I2V。",
    };
  if (input.firstFrame || input.mode === "i2v")
    return {
      videoModel: "h3",
      mode: "i2v",
      duration,
      reason: "已有首帧，使用 10Eros-Max I2V。",
    };
  if (input.hasReferenceImages)
    return {
      videoModel: "h3",
      mode: "ri2v",
      duration,
      reason: "已绑定参考图，使用 10Eros-Max 参考图生视频。",
    };
  return {
    videoModel: "h3",
    mode: "t2v",
    duration,
    reason: "按剧情生成连续单镜头，使用 H3 文生视频。",
  };
}

export function planFromShot(
  shot: Shot,
  assets: AssetCard[],
  tone: string,
  gpu?: GpuHint,
) {
  const linked = (shot.assetIds || [])
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetCard => !!a);
  return recommendVideoPlan({
    tone,
    duration: shot.duration,
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    mode: shot.mode,
    videoModel: shot.videoModel,
    modelPick: shot.modelPick,
    hasReferenceImages: linked.some((a) => a.imageUrl.trim()),
    hasReferenceMedia: !!shot.referenceMedia?.length,
    hasReferenceAudio: shot.referenceMedia?.some((m) => m.kind === "audio"),
    hasReferenceVideo: shot.referenceMedia?.some((m) => m.kind === "video"),
    gpu,
  });
}
