import { CHANNEL_MODULES, findChannelModule, type ChannelField } from "./channel-catalog";

export type MediaId = "image" | "video" | "audio" | "text";
export type StudioMode = "draw" | "image" | "clip" | "video";

export type WorkEngine = {
  id: string;
  label: string;
  detail: string;
} & (
  | { kind: "studio"; studio: StudioMode }
  | { kind: "channel"; moduleId: string }
);

export type WorkTool = {
  id: string;
  media: MediaId;
  label: string;
  detail: string;
  engines: readonly WorkEngine[];
};

export const MEDIA: readonly { id: MediaId; label: string }[] = [
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "text", label: "文本" },
];

export const DEFAULT_TOOL = "template-image";

function studio(id: string, mode: StudioMode, label: string, detail: string): WorkEngine {
  return { id, kind: "studio", studio: mode, label, detail };
}

function channel(moduleId: string, label: string, detail: string): WorkEngine {
  return { id: moduleId, kind: "channel", moduleId, label, detail };
}

export const WORK_TOOLS: readonly WorkTool[] = [
  {
    id: "template-image",
    media: "image",
    label: "模板出图",
    detail: "选一格画面，把角色放进去。",
    engines: [studio("studio-image", "image", "画面模板", "姿势、服装和场景跟模板。")],
  },
  {
    id: "text-image",
    media: "image",
    label: "文生图",
    detail: "只写句子，不上传图片。",
    engines: [
      studio("studio-draw", "draw", "先设计提示词", "语言模型先把这句话写成出图提示词。"),
      channel("pornmaster_t2i", "直接出图", "句子原样交给 PornMaster。"),
      channel("ai_chuangzuo_wenshengtu_dongman_fengge", "动漫", "动漫风格文生图。"),
      channel("ai_chuangzuo_wenshengtu_xieshi_fengge", "写实", "写实风格文生图。"),
      channel("generate-text2image", "通用", "可选模型名。"),
      channel("manju_wenshengtu_juese_shengcheng", "漫剧角色", "按句子生成角色设定图。"),
      channel("orchestrator-generate-images", "可带参考", "可以只写句子，也可以附一张参考图。"),
    ],
  },
  {
    id: "image-edit",
    media: "image",
    label: "图生图",
    detail: "一张参考图，按提示词重画。",
    engines: [
      channel("tushengtu", "通用", "一张图加提示词。"),
      channel("generate-image2image", "换模型", "可以指定模型名。"),
      channel("tushengtu_fengge_zhuanhuan", "风格", "保持内容，改画风。"),
      channel("tushengtu_tuya_chonghui", "涂鸦重绘", "在原图上按提示词重画。"),
      channel("tushengtu_tuya_chonghui_2", "涂鸦重绘 2", "多一个反向提示词。"),
      channel("qwen_image21_multi_image_edit", "多图", "1 到 9 张参考图一起用。"),
      channel("qwen_edit_three_pic", "固定三图", "正好三张图。"),
      channel("manju_tushengtu_1", "漫剧单人", "单人画面，可换脸。"),
      channel("manju_tushengtu_3", "漫剧风格", "单人，同时迁移风格。"),
      channel("manju_tushengtu_4", "漫剧通用", "一张图加提示词。"),
      channel("manju_tushengtu_dongman_fengge", "日式动漫", "把参考图画成日式动漫。"),
    ],
  },
  {
    id: "two-image",
    media: "image",
    label: "双图",
    detail: "两张图一起用，做背影或动作。",
    engines: [
      channel("tushengtu_beiying_zhuanhuan", "背影", "一张人物，一张背影参考。"),
      channel("dongzuo_kelong_shengtu", "动作克隆", "第一张是角色，第二张是动作。"),
      channel("tushengtu_dongzuo_bianji", "动作编辑", "第一张是角色，第二张是要改成的动作。"),
    ],
  },
  {
    id: "face-image",
    media: "image",
    label: "两图换脸",
    detail: "一张提供脸，一张提供画面。",
    engines: [
      channel("generate-face-swap", "通用", "脸部源换到目标图上。"),
      channel("generate-face-swap-male", "男性", "同一件事的男性模型。"),
      channel("huanlian_2", "带提示词", "两张图之外还可以写要求。"),
    ],
  },
  {
    id: "undress-image",
    media: "image",
    label: "按原图去衣",
    detail: "沿用原来的姿势和构图。",
    engines: [
      channel("generate-undress-images", "图片", "上传一张人物图。"),
      channel("generate-undress-images-male", "男性", "同一件事的男性模型。"),
      channel("generate-undress-anime", "动漫", "可以写场景和提示词。"),
      channel("generate-tattoos", "去衣加纹身", "目标图必填，脸部源可选。"),
    ],
  },
  {
    id: "scene-image",
    media: "image",
    label: "场景出图",
    detail: "按场景名出图，可以带参考。",
    engines: [
      channel("generate-qwen-two-image", "单人双人", "场景名必填，第二张图可选。"),
      channel("generate-img-scenes-shortvideo", "短视频场景", "场景名和参考图都可以留空。"),
      channel("generate-videos-scenes-qwen", "手办", "两张图合成手办图。"),
    ],
  },
  {
    id: "couple-image",
    media: "image",
    label: "双人出图",
    detail: "女性和男性各一张。",
    engines: [channel("manju_tushengtu_2", "双人场景", "两张角色图加提示词。")],
  },
  {
    id: "template-video",
    media: "video",
    label: "模板视频",
    detail: "选一个动作，角色跟着动。",
    engines: [studio("studio-video", "video", "动作模板", "大约 8 秒竖屏。")],
  },
  {
    id: "text-video",
    media: "video",
    label: "文生视频",
    detail: "只写动作，不上传图片。",
    engines: [
      studio("studio-clip", "clip", "8 秒成片", "句子交给 MiniMax H3。"),
      channel("minimax-h3_t2v", "自定时长", "同一条 H3，时长可以自己填。"),
      channel("ai_chuangzuo_wenshengshipin", "通用", "文生视频。"),
      channel("ai_chuangzuo_wenshengshipin_8s", "8 秒", "固定大约 8 秒。"),
      channel("t2v_10eros", "20 秒", "更长的文生视频。"),
    ],
  },
  {
    id: "image-video",
    media: "video",
    label: "图生视频",
    detail: "一张图，加上想看的动作。",
    engines: [
      channel("ai_chuangzuo_tushengshipin", "无声", "图生视频，没有声音。"),
      channel("ai_chuangzuo_tushengshipin_8s", "8 秒", "大约 8 秒。"),
      channel("i2v_10eros", "20 秒", "时长可以自己填。"),
      channel("i2v_short_video-2sampling_ltx2_3", "短视频", "LTX 双采样。"),
      channel("manju_tushengshipin", "有声", "漫剧图生视频。"),
    ],
  },
  {
    id: "reference-video",
    media: "video",
    label: "参考成片",
    detail: "用自己的参考图，不走动作模板。",
    engines: [
      channel("minimax-h3_i2v_reference", "多图", "1 到 9 张图，声音可选。"),
      channel("minimax-v2-h3_i2v_reference", "图音视频", "还可以再加一段参考视频。"),
    ],
  },
  {
    id: "frames-video",
    media: "video",
    label: "首尾帧",
    detail: "开头一张，结尾一张。",
    engines: [
      channel("i2v_short_video-fl_img_ltx2_3", "短视频", "首帧和尾帧都要有。"),
      channel("minimax-h3_fl2v_i2v", "H3", "两帧都可以留空，用提示词补。"),
      channel("manju_shouwei_zhen", "慢动作", "漫剧首尾帧。"),
    ],
  },
  {
    id: "audio-video",
    media: "video",
    label: "图音成片",
    detail: "让画面配上一段音频。",
    engines: [
      channel("ia2v_short_video-custom_audio_ltx2_3", "自定义音频", "一张图加一段音频。"),
      channel("ia2v_short_video-reference_audio_ltx2_3", "参考音频", "音频用来参考，不要求对口型。"),
      channel("ia2v_short_video-fl_img_custom_audio_ltx2_3", "首尾帧加音频", "两帧再配一段声音。"),
      channel("i2v_lip_syncing-wan22", "对口型", "一张图对着音频说话。"),
      channel("video_lip_sync", "对口型加提示词", "图、音频和提示词一起给。"),
    ],
  },
  {
    id: "motion-video",
    media: "video",
    label: "动作迁移",
    detail: "角色跟着另一张图或一条视频动。",
    engines: [
      channel("generate-pose_transfer-video", "姿势图", "一张角色，一张姿势。"),
      channel("dongzuo_kelong_shengshipin", "动作图", "两张图生成动作视频。"),
      channel("i2v_short_video-action_transfer_scail2", "参考视频", "一张角色图加一条动作视频。"),
    ],
  },
  {
    id: "face-video",
    media: "video",
    label: "视频换脸",
    detail: "把脸换进一条视频，或用两张图生成。",
    engines: [
      channel("huanlian", "视频换脸", "一条视频加一张脸。"),
      channel("generate-face-swap-video", "两图成片", "脸部源和目标图生成视频。"),
    ],
  },
  {
    id: "undress-video",
    media: "video",
    label: "去衣视频",
    detail: "一张人物图生成视频。",
    engines: [
      channel("generate-undress", "视频", "方法名可以留空。"),
      channel("generate-undress-anime-video", "动漫", "可以写场景和提示词。"),
    ],
  },
  {
    id: "scene-video",
    media: "video",
    label: "场景视频",
    detail: "同一张人物图，换场景和模型。",
    engines: [
      channel("generate-videos-scenes", "场景", "场景名可留空。"),
      channel("generate-videos-scenes-8s", "8 秒", "短场景。"),
      channel("generate-videos-scenes-20s", "20 秒", "长场景。"),
      channel("generate-videos-scenes-8s-ltx", "LTX", "可以写时长和音频开关。"),
      channel("generate-videos-scenes-dasiwa", "DaSiWa", "场景名必填。"),
      channel("generate-videos-scenes-minimax-h3-single", "H3 单人", "场景名必填。"),
      channel("generate-videos-scenes-minimax-h3-multi", "H3 多场景", "用四视图，场景名必填。"),
      channel("generate-videos-scenes-double", "双人", "两张人物图。"),
      channel("generate-videos-scenes-shortvideo", "短视频", "可以写时长。"),
      channel("generate-videos-scenes-webp", "WebP", "输出动图。"),
    ],
  },
  {
    id: "watermark-video",
    media: "video",
    label: "去水印",
    detail: "去掉画面里的水印。",
    engines: [
      channel("video_remove_watermark-bernini", "直接去除", "只上传视频。"),
      channel("video_remove_watermark", "带提示词", "写明要去掉什么。"),
      channel("video_remove_watermark-long_video", "长视频", "提示词可选。"),
    ],
  },
  {
    id: "speech",
    media: "audio",
    label: "文字转语音",
    detail: "把句子读出来。",
    engines: [
      channel("generate-audio", "直接朗读", "先选一个音色。"),
      channel("generate-ttsv2", "指定音色", "先选音色，情绪可选。"),
    ],
  },
  {
    id: "voice-clone",
    media: "audio",
    label: "音色克隆",
    detail: "用一段声音来读，或先登记音色。",
    engines: [
      channel("tts_voice_cloning-qwen3", "朗读", "参考音频加要读的句子。"),
      channel("tts_voice_cloning-voxcpm", "带描述", "还可以写这个声音是什么样。"),
      channel("generate-ttsv2-speaker", "登记音色", "保存一段声音，供以后的音色编号使用。"),
      channel("generate-audio-upload", "登记并试读", "音色编号、参考句和参考音频都要有。"),
    ],
  },
  {
    id: "dub-video",
    media: "audio",
    label: "视频配音",
    detail: "给现成视频加声音。",
    engines: [
      channel("video_voiceover-woosh", "配音", "按画面配一段声音。"),
      channel("video_voiceover_sync_lip-mmaudio", "对口型", "声音和嘴型一起做。"),
      channel("video_voiceover_sync_lip-woosh", "对口型 2", "另一条对口型路线。"),
    ],
  },
  {
    id: "novel",
    media: "text",
    label: "写小说",
    detail: "从剧情说明写一篇。",
    engines: [channel("generate-novel", "新写", "人物、地点和字数都可以留空。")],
  },
  {
    id: "novel-continue",
    media: "text",
    label: "续写小说",
    detail: "接着已有正文往下写。",
    engines: [channel("continue-novel", "续写", "上传正文，或贴一个 https 文本链接。")],
  },
  {
    id: "prompt-writer",
    media: "text",
    label: "提示词优化",
    detail: "看图，写出能拿去生图的提示词。",
    engines: [channel("qwen_vqa", "看图写词", "至少一张图，后两张可选。")],
  },
];

const assigned = WORK_TOOLS.flatMap(tool => tool.engines.flatMap(engine => engine.kind === "channel" ? [engine.moduleId] : []));
const seen = new Set<string>();
for (const id of assigned) {
  if (seen.has(id)) throw new Error(`渠道能力重复归类：${id}`);
  seen.add(id);
  if (!findChannelModule(id)) throw new Error(`渠道能力不存在：${id}`);
}
for (const item of CHANNEL_MODULES) {
  if (!seen.has(item.id)) throw new Error(`渠道能力还没归进工具：${item.id}`);
}

const PLAIN_LABEL: Record<string, string> = {
  img_url: "图片",
  image_url: "图片",
  mask_url: "遮罩",
  img1_url: "第一张图",
  img2_url: "第二张图",
  img_url1: "第一张图",
  img_url2: "第二张图",
  img_url3: "第三张图",
  image_urls: "参考图",
  source_img1_url: "第一张图",
  source_img2_url: "第二张图",
  clothes_img_url: "服装图",
  people_img_url: "人物图",
  female_img_url: "女性角色",
  male_img_url: "男性角色",
  first_img_url: "首帧",
  last_img_url: "尾帧",
  first_image: "首帧",
  end_image: "尾帧",
  video_url: "视频",
  audio_url: "音频",
  img_url_1: "第一张图",
  img_url_2: "第二张图",
  img_url_3: "第三张图",
  image_url_1: "第一张图",
  image_url_2: "第二张图",
  image_url_3: "第三张图",
  source_path: "图片",
  target_path: "第二张图",
};

export type ToolCover = { kind: "image" | "video"; id: string } | { kind: "poster" };

const COVERS: Record<string, ToolCover> = {
  "template-image": { kind: "image", id: "krea2-069-pvc-racing-bodysuit" },
  "text-image": { kind: "image", id: "krea2-ahegao-face" },
  "image-edit": { kind: "image", id: "krea2-aio-nsfw" },
  "two-image": { kind: "image", id: "krea2-arm-grab-doggystyle" },
  "face-image": { kind: "image", id: "krea2-better-lip-bite" },
  "undress-image": { kind: "image", id: "krea2-excellent-full-nude" },
  "scene-image": { kind: "image", id: "krea2-dynamic-pov-cowgirl-sex-cosplay" },
  "couple-image": { kind: "image", id: "krea2-krea2-full-nelson" },
  "template-video": { kind: "video", id: "h3-cowgirl" },
  "text-video": { kind: "video", id: "h3-missionary" },
  "image-video": { kind: "video", id: "h3-doggy" },
  "reference-video": { kind: "video", id: "h3-titfuck" },
  "frames-video": { kind: "video", id: "h3-fingering" },
  "audio-video": { kind: "video", id: "h3-blowjob" },
  "motion-video": { kind: "video", id: "h3-handjob" },
  "face-video": { kind: "image", id: "krea2-biting-lips" },
  "undress-video": { kind: "image", id: "krea2-luminnude-v02f" },
  "scene-video": { kind: "video", id: "h3-dildo" },
  "watermark-video": { kind: "video", id: "h3-bikini" },
  "speech": { kind: "image", id: "krea2-lip-bite" },
  "voice-clone": { kind: "image", id: "krea2-tongue-out" },
  "dub-video": { kind: "video", id: "h3-ahegao" },
  "novel": { kind: "poster" },
  "novel-continue": { kind: "poster" },
  "prompt-writer": { kind: "poster" },
};

for (const tool of WORK_TOOLS) {
  if (!COVERS[tool.id]) throw new Error(`工具还没有封面：${tool.id}`);
}

export function toolCover(id: string): ToolCover {
  return COVERS[id] ?? { kind: "poster" };
}

export function presentField(field: ChannelField): string {
  const raw = field.label.trim();
  if (!/url/i.test(raw)) return raw;
  const cleaned = raw
    .replace(/HTTP\(S\)/gi, "")
    .replace(/URL/gi, "")
    .replace(/的\s*JSON\s*数组/gi, "")
    .replace(/[；;，,].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^[a-z0-9 ]+$/i.test(cleaned)) return PLAIN_LABEL[field.key] ?? (cleaned || raw);
  return cleaned;
}

export function toolsFor(media: MediaId): WorkTool[] {
  return WORK_TOOLS.filter(tool => tool.media === media);
}

export function findWorkTool(id: string): WorkTool | undefined {
  return WORK_TOOLS.find(tool => tool.id === id);
}

export function toolMedia(id: string): MediaId {
  return findWorkTool(id)?.media ?? "image";
}
