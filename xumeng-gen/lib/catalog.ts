import catalog from "../data/catalog.json";
import hiddenImageTemplates from "../data/hidden-image-templates.json";

export type ImageTemplate = {
  id: string;
  label: string;
  englishLabel: string;
  group: string;
  aspectRatio: string;
  frame: string;
};

export type VideoTemplate = {
  id: string;
  label: string;
  englishLabel: string;
  description: string;
  action: string;
};

const HIDDEN_IMAGES = new Set(hiddenImageTemplates);
export const IMAGE_TEMPLATES = (catalog.images as ImageTemplate[]).filter(item => !HIDDEN_IMAGES.has(item.id));
export const IMAGE_GROUPS = (catalog.groups as { id: string; label: string }[]).filter(group => IMAGE_TEMPLATES.some(item => item.group === group.id));

const STUDIO_IMAGE_IDS = [
  "krea2-069-pvc-racing-bodysuit",
  "krea2-cat-lingerie",
  "krea2-fishnet-fantasy-lingerie",
  "krea2-playboy-bunny-fetish-set",
  "krea2-sheer-lace-trim-babydoll",
  "krea2-hotel-uniform-red",
  "krea2-micro-bikini",
  "krea2-excellent-full-nude",
  "krea2-only-towel",
  "krea2-face-down-ass-up",
  "krea2-missionary-position",
  "krea2-sex-cowgirl",
  "krea2-arm-grab-doggystyle",
  "krea2-prone-bone",
  "krea2-anal-sex",
  "krea2-pov-titjob-titty-fuck",
  "krea2-pov-handjob",
  "krea2-creampie",
  "krea2-dildo",
  "krea2-shibari-rope-bondage",
  "krea2-tied-to-bed",
  "krea2-ahegao-face",
];

const STUDIO_IMAGE_ID_SET = new Set(STUDIO_IMAGE_IDS);
const STUDIO_IMAGE_BY_ID = new Map(IMAGE_TEMPLATES.map(item => [item.id, item]));
export function studioImageListed(id: string): boolean {
  return STUDIO_IMAGE_ID_SET.has(id);
}
export const STUDIO_IMAGE_TEMPLATES = STUDIO_IMAGE_IDS.flatMap(id => {
  const item = STUDIO_IMAGE_BY_ID.get(id);
  return item ? [item] : [];
});
export const STUDIO_IMAGE_GROUPS = IMAGE_GROUPS.filter(group => STUDIO_IMAGE_TEMPLATES.some(item => item.group === group.id));
export const VIDEO_TEMPLATES = catalog.videos as VideoTemplate[];

const IMAGE_IDS = new Set(IMAGE_TEMPLATES.map(item => item.id));
const VIDEO_IDS = new Set(VIDEO_TEMPLATES.map(item => item.id));

export function imageTemplate(id: string): ImageTemplate | null {
  return IMAGE_IDS.has(id) ? IMAGE_TEMPLATES.find(item => item.id === id) ?? null : null;
}

export function videoTemplate(id: string): VideoTemplate | null {
  return VIDEO_IDS.has(id) ? VIDEO_TEMPLATES.find(item => item.id === id) ?? null : null;
}

export const STYLES = [
  { id: "anime", label: "日系赛璐璐" },
  { id: "cinema", label: "动画电影" },
  { id: "soft", label: "柔光厚涂" },
  { id: "film", label: "漫画分镜" },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

export function styleId(value: unknown): StyleId {
  return STYLES.some(item => item.id === value) ? value as StyleId : "anime";
}

const ANIME_RULE = "输出只能是二次元动漫。角色是虚构的成年二次元人物，二十一岁以上，脸型和身材都是成人。不要写实真人，不要复刻照片里的真实人物。不要未成年、幼态面孔、校服或学生设定。";
const BLOCKED_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;
const MINOR_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b/i;

export function noteError(note: string): string | null {
  const text = note.replace(/[\u0000-\u001f]/g, " ");
  if (!BLOCKED_NOTE.test(text)) return null;
  return MINOR_NOTE.test(text) ? "不能生成未成年或幼态角色。" : "这里只生成虚构的成年角色。";
}

function cleanPrompt(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function stillPrompt(frame: string, note: string): string {
  const scene = cleanPrompt(frame, 500);
  const extra = cleanPrompt(note, 400);
  const binding = [
    ANIME_RULE,
    "第一张图只在它本身是成年二次元角色时，保留发型、发色和五官画风。它如果是真人照片，改画成原创的成年二次元角色，不要留下这个真人的脸。",
    "第二张图只提供姿势、肢体位置、服装、场景和光线。第二张图里原来的脸、表情、发型和身份不要留下来。",
    "把这个虚构的成年二次元角色放进第二张图的姿势、服装和场景里。",
  ].join("");
  return [binding, scene, extra ? `补充：${extra}` : ""].filter(Boolean).join("").slice(0, 2000);
}

export function channelVideoPrompt(action: string, note: string): string {
  const motion = cleanPrompt(action, 500);
  const extra = cleanPrompt(note, 400);
  const binding = [
    ANIME_RULE,
    "参考图只在它本身是成年二次元角色时，保留发型、发色和五官画风。它如果是真人照片，改画成原创的成年二次元角色，不要留下这个真人的脸。",
    "参考视频只提供姿势、肢体动作、服装、场景、光线和镜头。参考视频里原来的脸、表情、发型和身份不要留下来。",
    "让这个虚构的成年二次元角色做参考视频里的动作。第一帧已经是参考视频的姿势。",
  ].join("");
  return [binding, motion, extra ? `补充：${extra}` : ""].filter(Boolean).join("").slice(0, 2000);
}

export function videoPrompt(action: string, note: string): string {
  const extra = note.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
  const lines = [
    "规格：5秒 | 24fps | 二次元动漫连续单镜头 | 9:16。同一空间、连续时间、一条运镜；无内部切镜、无跳切、无蒙太奇、无黑场。",
    "主体：虚构的成年二次元角色。Image 1 只在它本身是成年二次元角色时保留发型、发色和五官画风。Image 1 如果是真人照片，改画成原创成年二次元角色，不要留下这个真人的脸。Video 1 提供姿势、服装、房间、光线和动作。",
    "时间轴：",
    "0–2秒：先站住。姿势、服装、房间和机位沿用 Video 1 的开头。脸上是虚构的成年二次元角色。",
    `动作：${action}一个连贯镜头。`,
    "中间：接触、方向和重量跟随 Video 1。发型和五官画风保持这个二次元角色。",
    "末1–2秒：停在 Video 1 结束时的静止姿势，不再开新动作。身份仍是这个虚构的成年二次元角色。",
    "镜头：跟随 Video 1，一个景别加一种连续运镜，不切镜。",
    "场景：沿用 Video 1 的房间、服装和光线。",
    "声音：只保留现场的身体与环境声，无旁白，无突然出现的背景音乐。",
    "风格：二次元动漫，虚构的成年角色，21岁以上。不要写实真人。",
    "光线：沿用 Video 1。",
    "连续性：把虚构的成年二次元角色放进 Video 1，替换模板里原来的人。Image 1 不是第一帧照片；第一帧已经是 Video 1 的姿势。Video 1 原来的脸、发型和身份不要留下来。画面里若还有另一个身体，那个身体只保留 Video 1 的姿势和接触，不把 Video 1 的脸安到主体上。",
    extra ? `补充：${extra}。` : "",
    "无字幕、无水印、无面部漂移、无身份更换、无多余手指、无手指粘连、无穿模、无油腻皮肤、无畸形生殖器、无未成年人、无幼态面孔、无校服。",
  ].filter(Boolean);
  return lines.join("\n")
    .replace(/Image\s*(\d+)/gi, "<Picture $1>")
    .replace(/(?<!<)Video\s*(\d+)/gi, "<Video $1>")
    .replace(/(?<!<)Audio\s*(\d+)/gi, "<Audio $1>");
}

export function assetOrigin(): string {
  return (process.env.ASSET_ORIGIN || "https://xumengchat.top").replace(/\/$/, "");
}
