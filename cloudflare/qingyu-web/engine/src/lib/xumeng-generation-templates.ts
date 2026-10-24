import type { GenerationKind } from "./xumeng-generation";
import { H3_ACTION_TEMPLATES } from "./xumeng-h3-actions";
import { INTIMATE_STILL_TEMPLATES } from "./xumeng-intimate-stills";
import { KREA2_STILL_TEMPLATES } from "./xumeng-krea2-stills";

export const GENERATION_TEMPLATE_CATEGORIES = [
  { id: "character", label: "人物", description: "立绘、头像与角色镜头" },
  { id: "scene", label: "场景", description: "环境、空间与氛围镜头" },
  { id: "cover", label: "封面", description: "书封、唱片与活动主视觉" },
  { id: "product", label: "商品", description: "产品静物与展示短片" },
  { id: "short-film", label: "短片", description: "分镜、开场与日常片段" },
] as const;

export type GenerationTemplateCategory = typeof GENERATION_TEMPLATE_CATEGORIES[number]["id"];
export type GenerationTemplateField = { id: string; label: string; placeholder: string; description?: string };
export type GenerationTemplate = {
  id: string;
  kind: GenerationKind;
  label: string;
  englishLabel: string;
  description: string;
  categories: readonly GenerationTemplateCategory[];
  tags: readonly string[];
  aspectRatio: string;
  fields: readonly GenerationTemplateField[];
  /** Editable examples, independent of placeholders. Selecting a template never submits them. */
  defaultValues: Readonly<Record<string, string>>;
  pattern: string;
  /** Historical templates stay addressable for saved drafts and job history. */
  archived?: boolean;
  /** Site-owned motion illustration; it is not sent to the generation provider. */
  demoVideoUrl?: string;
  demoPosterUrl?: string;
  /** Required subjects for a fixed action; distinct from motion-demo identity. */
  actionParticipants?: 2;
  /** Published MiniMax H3 LoRA identity. The preview is not sent to the current video provider. */
  h3Lora?: {
    repo: "EllaPriest45/MinimaxH3_Actions";
    weightFile: string;
    strength: string;
    trigger: string;
  };
  /** Reserved legacy provider field; no such templates are included in Qingyu. */
  imageProvider?: "unfiltered-pending";
  /** Published Krea2 still LoRA. The preview is not sent to the current image provider. */
  krea2Lora?: {
    repo: "EllaPriest45/Krea2_actions";
    weightFile: string;
    strength: string;
    trigger: string;
    group: string;
  };
};
export type GenerationTemplateFilters = {
  kind?: GenerationKind | "all";
  category?: GenerationTemplateCategory | "all";
  query?: string;
};

const subject = { id: "subject", label: "主体", placeholder: "例如：穿旅行外套的成年女探险家", description: "写清外观、服装或物品特征。" };
const scene = { id: "scene", label: "场景", placeholder: "例如：雨后的海港，灯火倒映水面", description: "描述地点、时间和环境细节。" };
const style = { id: "style", label: "画面风格", placeholder: "例如：细腻动画，柔和电影光线", description: "选择画法、色彩和光线。" };
const product = { ...subject, label: "商品", placeholder: "例如：一只白色陶瓷咖啡杯", description: "写清材质、颜色和外形。" };
const animationStyle = "细腻动画，柔和电影光线";
const referenceActionBase = "以用户上传的参考图作为起始画面。沿用图中原有的两名人物，保持各自面部、发型、服装、体型、左右身份、背景和画面风格一致，不新增、替换或合并人物。只让原图人物完成下述同类动作，不重新设计角色、场景或剧情。";
const referenceActionCamera = "固定机位，采用能同时看清两人和手部的中景，一个连贯镜头，不切镜、不变焦；手臂和身体运动自然，避免肢体穿透。不要字幕或水印。";

/** Full catalog includes archived IDs so old compiler snapshots remain recoverable. */
export const GENERATION_TEMPLATES: readonly GenerationTemplate[] = [
  { id: "character-portrait", kind: "image", archived: true, label: "人物立绘", englishLabel: "Character Portrait", description: "服装、神态与人物特征", categories: ["character"], tags: ["角色", "全身", "立绘", "portrait"], aspectRatio: "3:4", fields: [subject, style], defaultValues: { subject: "穿深蓝旅行外套的成年女探险家，短发，背着帆布包", style: animationStyle }, pattern: "绘制角色立绘：{{subject}}。完整着装，人物轮廓清晰，神态自然，简洁背景。画面风格：{{style}}。不添加文字和水印。" },
  { id: "scene-image", kind: "image", archived: true, label: "故事场景", englishLabel: "Story Environment", description: "把故事发生的地方画出来", categories: ["scene"], tags: ["背景", "环境", "氛围", "environment"], aspectRatio: "16:9", fields: [scene, style], defaultValues: { scene: "雨后的海港旧码头，暖黄路灯倒映在水面", style: "水彩概念图，冷暖光线交错" }, pattern: "故事场景概念图：{{scene}}。空间关系合理，突出环境细节与氛围，适合角色扮演的场景背景。风格：{{style}}。不添加文字。" },
  { id: "novel-cover", kind: "image", archived: true, label: "小说封面", englishLabel: "Novel Cover", description: "预留标题位置的封面底图", categories: ["cover"], tags: ["小说", "书封", "插画", "book"], aspectRatio: "3:4", fields: [subject, scene, style], defaultValues: { subject: "手持旧航海图的成年图书管理员", scene: "夜晚的灯塔与远处海港", style: "复古奇幻插画，深蓝与金色" }, pattern: "小说封面插画底图。主体：{{subject}}。场景：{{scene}}。风格：{{style}}。竖版构图，上方保留标题留白；画面本身不绘制文字和水印。" },
  { id: "product-image", kind: "image", archived: true, label: "商品海报", englishLabel: "Product Poster", description: "用于展示、宣传的产品画面", categories: ["product"], tags: ["海报", "静物", "电商", "advertising"], aspectRatio: "1:1", fields: [product, scene, style], defaultValues: { subject: "一只白色陶瓷咖啡杯，细腻哑光釉面", scene: "靠窗的木桌，旁边放着几粒咖啡豆", style: "自然光商业摄影，简洁暖色背景" }, pattern: "产品展示海报底图：{{subject}}。环境：{{scene}}。风格：{{style}}。突出产品材质与轮廓，合理光影；不添加品牌、文字或水印。" },
  { id: "story-opening", kind: "video", archived: true, label: "剧情开场", englishLabel: "Story Opening", description: "从环境切入故事的镜头", categories: ["scene", "short-film"], tags: ["开场", "推进", "氛围", "opening"], aspectRatio: "16:9", fields: [scene, style], defaultValues: { scene: "清晨的海港书店，薄雾散去，门前风铃轻轻摇动", style: "温暖电影感，柔和晨光" }, pattern: "短片开场镜头：{{scene}}。缓慢推进镜头，环境中出现自然细微运动，用一个连贯镜头建立故事氛围。风格：{{style}}。不要字幕或水印。" },
  { id: "character-entry", kind: "video", archived: true, label: "角色登场", englishLabel: "Character Entrance", description: "动作与情绪明确的登场片段", categories: ["character", "short-film"], tags: ["角色", "登场", "人物", "entrance"], aspectRatio: "9:16", fields: [subject, scene, style], defaultValues: { subject: "穿米色风衣的成年海港记者，手持笔记本", scene: "傍晚的书店门口", style: "细腻动画，金色夕阳" }, pattern: "角色登场短片：{{subject}}，出现在{{scene}}。完整着装，自然走近镜头后停下，露出符合角色的神情。稳定连贯的镜头，保持人物外观一致。风格：{{style}}。不要字幕。" },
  { id: "product-video", kind: "video", archived: true, label: "产品展示", englishLabel: "Product Showcase", description: "围绕主体缓慢运动的镜头", categories: ["product", "short-film"], tags: ["商品", "环绕", "材质", "showcase"], aspectRatio: "16:9", fields: [product, scene, style], defaultValues: { subject: "一只白色陶瓷咖啡杯，杯口冒出轻微热气", scene: "干净的木桌与柔和窗光", style: "真实产品摄影，柔和暖色" }, pattern: "产品展示短片。主体：{{subject}}。场景：{{scene}}。镜头缓慢环绕主体，材质清晰，光影自然。风格：{{style}}。不要字幕、品牌或水印。" },
  { id: "character-avatar", kind: "image", archived: true, label: "角色头像", englishLabel: "Character Avatar", description: "适合圆形裁切的半身头像", categories: ["character"], tags: ["头像", "半身", "社交", "avatar"], aspectRatio: "1:1", fields: [subject, style], defaultValues: { subject: "戴圆框眼镜的成年植物学家，绿色衬衫，温和微笑", style: "清新数字插画，浅绿色背景" }, pattern: "绘制角色半身头像：{{subject}}。完整着装，面部清楚，人物居中，头部四周留出裁切空间，背景简洁。风格：{{style}}。不添加文字或水印。" },
  { id: "character-costume", kind: "image", archived: true, label: "服装设定", englishLabel: "Costume Design", description: "用清晰正面构图设计服装", categories: ["character"], tags: ["服装", "设定", "配色", "costume"], aspectRatio: "3:4", fields: [subject, style], defaultValues: { subject: "成年灯塔守护员，深蓝长外套、铜色纽扣、厚底靴和腰间工具袋", style: "干净线稿与柔和上色，浅灰背景" }, pattern: "角色服装设定图：{{subject}}。正面全身站姿，完整着装，展示衣服的层次、配色与配件，不使用复杂动作遮挡服装。风格：{{style}}。不添加文字、品牌或水印。" },
  { id: "environment-detail", kind: "image", archived: true, label: "场景特写", englishLabel: "Environment Detail", description: "用一处细节建立故事氛围", categories: ["scene"], tags: ["特写", "道具", "细节", "detail"], aspectRatio: "4:3", fields: [subject, scene, style], defaultValues: { subject: "一封封着蓝色蜡印的信和一枚旧铜钥匙", scene: "海港旅馆的木质窗台，雨滴停留在玻璃上", style: "电影静物摄影，柔和侧光" }, pattern: "故事场景细节特写。主体：{{subject}}。环境：{{scene}}。聚焦主体材质与环境的联系，背景适度虚化，保留清楚的空间线索。风格：{{style}}。不添加可读文字或水印。" },
  { id: "interior-background", kind: "image", archived: true, label: "室内空间", englishLabel: "Interior Background", description: "为互动场景设计可用的空间", categories: ["scene"], tags: ["室内", "空间", "背景", "interior"], aspectRatio: "16:9", fields: [scene, style], defaultValues: { scene: "临海小镇的二手书店，入口、柜台、阅读角和靠窗长桌分布清楚", style: "温暖写实插画，午后自然光" }, pattern: "室内场景背景图：{{scene}}。平视广角构图，入口、通道与主要区域位置合理，适合人物在空间中行动，避免拥挤与遮挡。风格：{{style}}。不添加文字或水印。" },
  { id: "album-cover", kind: "image", archived: true, label: "唱片封面", englishLabel: "Album Cover", description: "以色彩和意象表达音乐情绪", categories: ["cover"], tags: ["唱片", "音乐", "意象", "music"], aspectRatio: "1:1", fields: [subject, scene, style], defaultValues: { subject: "漂浮在水面上的一朵白色山茶花", scene: "月光下平静的海湾，远处有一盏暖灯", style: "简洁梦幻摄影，蓝白配色" }, pattern: "原创唱片封面底图。核心意象：{{subject}}。环境：{{scene}}。以色彩、留白和光影表达情绪，保持简洁而有辨识度的方形构图。风格：{{style}}。不添加文字、品牌或水印。" },
  { id: "event-poster", kind: "image", archived: true, label: "活动主视觉", englishLabel: "Event Poster", description: "为阅读会等活动预留信息区", categories: ["cover"], tags: ["活动", "海报", "留白", "event"], aspectRatio: "3:4", fields: [subject, scene, style], defaultValues: { subject: "围成半圆的几本彩色书籍和一盏小台灯", scene: "社区图书馆的木桌", style: "轻松纸艺插画，奶油黄和湖蓝配色" }, pattern: "原创活动海报主视觉底图。主体：{{subject}}。环境：{{scene}}。视觉重点位于画面下半部，上半部保留整洁的信息区域，不绘制文字。风格：{{style}}。不添加品牌或水印。" },
  { id: "storyboard-sheet", kind: "image", archived: true, label: "短片分镜", englishLabel: "Short Film Storyboard", description: "先用三格画面规划简单镜头", categories: ["short-film", "scene"], tags: ["分镜", "三格", "镜头", "storyboard"], aspectRatio: "16:9", fields: [subject, scene, style], defaultValues: { subject: "成年邮差从街口走到书店，将信交给店员", scene: "清晨的海港书店门前", style: "简洁动画分镜，清楚线条与统一配色" }, pattern: "横向排列的三格短片分镜图。事件：{{subject}}。场景：{{scene}}。三格依次展示环境全景、主要动作中景、结果特写，每格构图清楚，保持人物服装与场景一致。风格：{{style}}。不添加对白、文字或水印。" },
  { id: "product-flatlay", kind: "image", archived: true, label: "商品平铺", englishLabel: "Product Flat Lay", description: "从俯视角度展示商品与配件", categories: ["product"], tags: ["俯拍", "平铺", "配件", "flatlay"], aspectRatio: "1:1", fields: [product, scene, style], defaultValues: { subject: "一本浅蓝笔记本、一支木质铅笔和一个帆布收纳袋", scene: "干净的浅色桌面，旁边点缀一片绿叶", style: "自然光静物摄影，整洁柔和" }, pattern: "商品平铺展示图。商品：{{subject}}。环境：{{scene}}。垂直俯视构图，物件之间留有间距，清楚呈现各件商品，阴影柔和，不遮挡主体。风格：{{style}}。不添加品牌、文字或水印。" },
  { id: "scene-timelapse", kind: "video", archived: true, label: "环境流动", englishLabel: "Ambient Scene Motion", description: "让云、水与灯光带出时间感", categories: ["scene", "short-film"], tags: ["环境", "固定镜头", "时间", "ambient"], aspectRatio: "16:9", fields: [scene, style], defaultValues: { scene: "傍晚的海湾，云缓慢移动，水面泛起细小波纹，岸边灯光亮起", style: "写实电影画面，蓝调时刻" }, pattern: "环境氛围短片：{{scene}}。使用固定机位，让云、水面、植物或灯光产生自然细微变化，时间推进平缓，保持空间结构稳定。风格：{{style}}。不要字幕或水印。" },
  { id: "cover-reveal", kind: "video", archived: true, label: "封面氛围片", englishLabel: "Cover Atmosphere", description: "制作能截作封面的意象镜头", categories: ["cover", "short-film"], tags: ["封面", "意象", "定格", "cover"], aspectRatio: "9:16", fields: [subject, scene, style], defaultValues: { subject: "一把立在窗边的旧木吉他", scene: "安静的阁楼，晨光穿过薄纱窗帘", style: "温暖电影感，琥珀色光线" }, pattern: "封面氛围短片。核心意象：{{subject}}。环境：{{scene}}。镜头缓慢靠近主体，末尾停留在清楚的竖版构图，画面上方保留标题留白，环境只有自然细微运动。风格：{{style}}。不要字幕、文字或水印。" },
  { id: "daily-vignette", kind: "video", archived: true, label: "日常小片段", englishLabel: "Daily Vignette", description: "用一个简单动作表现人物性格", categories: ["short-film", "character"], tags: ["日常", "动作", "人物", "vignette"], aspectRatio: "16:9", fields: [subject, scene, style], defaultValues: { subject: "成年书店店员整理桌上的书籍，发现夹在书中的一片叶子后微笑", scene: "午后安静的海港书店", style: "清新动画，柔和窗光" }, pattern: "原创日常短片。人物与动作：{{subject}}。场景：{{scene}}。完整着装，以一个简单动作和自然表情表现性格，用连贯中景完成片段，保持人物外观与空间关系稳定。风格：{{style}}。不要字幕或水印。" },
  { id: "action-high-five", kind: "video", archived: true, label: "双人击掌", englishLabel: "Two-person High Five", description: "让原图中的两个人击掌一次", categories: ["character", "short-film"], tags: ["参考图", "双人", "动作", "击掌", "high five"], aspectRatio: "16:9", fields: [], defaultValues: {}, demoVideoUrl: "/assets/qingyu/action-templates/action-high-five.mp4", demoPosterUrl: "/assets/qingyu/action-templates/action-high-five.png", actionParticipants: 2, pattern: `${referenceActionBase}动作：前段，两人自然转向彼此，各举起靠近对方的一只手；中段，两只手掌在两人之间轻轻击掌一次；末段，分开手掌，放下手臂，保持自然神态，不重复击掌。${referenceActionCamera}` },
  { id: "action-handshake", kind: "video", archived: true, label: "双人握手", englishLabel: "Two-person Handshake", description: "让原图中的两个人自然握手", categories: ["character", "short-film"], tags: ["参考图", "双人", "动作", "握手", "handshake"], aspectRatio: "16:9", fields: [], defaultValues: {}, demoVideoUrl: "/assets/qingyu/action-templates/action-handshake.mp4", demoPosterUrl: "/assets/qingyu/action-templates/action-handshake.png", actionParticipants: 2, pattern: `${referenceActionBase}动作：前段，两人面向彼此，分别伸出右手；中段，右手相握，轻轻上下摇动一次；末段，松开并收回各自的手，停留在自然站姿，不重复握手。${referenceActionCamera}` },
  { id: "action-hug", kind: "video", archived: true, label: "双人拥抱", englishLabel: "Two-person Hug", description: "让原图中的两个人轻轻拥抱", categories: ["character", "short-film"], tags: ["参考图", "双人", "动作", "拥抱", "hug"], aspectRatio: "16:9", fields: [], defaultValues: {}, demoVideoUrl: "/assets/qingyu/action-templates/action-hug.mp4", demoPosterUrl: "/assets/qingyu/action-templates/action-hug.png", actionParticipants: 2, pattern: `${referenceActionBase}动作：前段，两人相互看向对方，同时张开双臂并靠近；中段，两人轻轻拥抱，短暂停留，双方动作自然配合；末段，松开双臂，稍稍退开并微笑，不重复拥抱。${referenceActionCamera}` },
  { id: "action-object-exchange", kind: "video", archived: true, label: "递交小物", englishLabel: "Two-person Object Exchange", description: "让原图中的一人把小物递给另一人", categories: ["character", "short-film"], tags: ["参考图", "双人", "动作", "递物", "交换", "exchange"], aspectRatio: "16:9", fields: [], defaultValues: {}, demoVideoUrl: "/assets/qingyu/action-templates/action-object-exchange.mp4", demoPosterUrl: "/assets/qingyu/action-templates/action-object-exchange.png", actionParticipants: 2, pattern: `${referenceActionBase}动作：左侧人物把手中的便携小物递给右侧人物；优先使用参考图中已有的小物，若图中没有适合的小物，则只使用一张无文字的小卡片。前段，左侧人物伸手递出小物，右侧人物伸手接取；中段，两人的手短暂靠近完成一次交接，小物从左侧手中进入右侧手中；末段，左侧人物收回空手，右侧人物持住小物。保持小物只有一件，不复制、不凭空消失，不重复交换。${referenceActionCamera}` },
  { id: "action-side-by-side-walk", kind: "video", archived: true, label: "并肩行走", englishLabel: "Side-by-side Walk", description: "让原图中的两个人并肩向前走", categories: ["character", "short-film"], tags: ["参考图", "双人", "动作", "并肩", "行走", "walk"], aspectRatio: "16:9", fields: [], defaultValues: {}, demoVideoUrl: "/assets/qingyu/action-templates/action-side-by-side-walk.mp4", demoPosterUrl: "/assets/qingyu/action-templates/action-side-by-side-walk.png", actionParticipants: 2, pattern: `${referenceActionBase}动作：前段，两人保持参考图中的左右顺序，转向相同方向准备行走；中段，两人并肩以自然步幅向前走两小步，手臂随步伐轻微摆动；末段，平稳停下，仍在画面内。保持两人间距与各自身份，不交叉换位、不漂浮、不转入新场景。${referenceActionCamera}` },
  { id: "action-paired-dance", kind: "video", archived: true, label: "双人舞步", englishLabel: "Paired Simple Dance", description: "让原图中的两个人同步跳简单舞步", categories: ["character", "short-film"], tags: ["参考图", "双人", "动作", "舞步", "同步", "dance"], aspectRatio: "16:9", fields: [], defaultValues: {}, demoVideoUrl: "/assets/qingyu/action-templates/action-paired-dance.mp4", demoPosterUrl: "/assets/qingyu/action-templates/action-paired-dance.png", actionParticipants: 2, pattern: `${referenceActionBase}动作：前段，两人保持左右顺序，相邻的手轻轻相握，另一只手抬起；中段，两人同步向左迈一小步，再向右迈一小步，抬起的手臂随节奏轻微摆动，完成一个简单舞步组合；末段，回到各自的自然站姿，相邻的手仍轻轻相握。两人动作同步、始终完整着装，不旋转、不交叉换位、不增加复杂动作。${referenceActionCamera}` },
  ...H3_ACTION_TEMPLATES,
  ...INTIMATE_STILL_TEMPLATES,
  ...KREA2_STILL_TEMPLATES,
];

/** New selections exclude historical text-led video templates. */
export const ACTIVE_GENERATION_TEMPLATES: readonly GenerationTemplate[] = GENERATION_TEMPLATES.filter(template => !template.archived);

export function isGenerationTemplateCategory(value: unknown): value is GenerationTemplateCategory {
  return typeof value === "string" && GENERATION_TEMPLATE_CATEGORIES.some(category => category.id === value);
}

export function getGenerationTemplateCategory(id: GenerationTemplateCategory) {
  return GENERATION_TEMPLATE_CATEGORIES.find(category => category.id === id) ?? null;
}

/** IDs are exact catalog values, never object keys or user-provided prompt fragments. */
export function getGenerationTemplate(id: string | null | undefined): GenerationTemplate | null {
  return typeof id === "string" ? GENERATION_TEMPLATES.find(template => template.id === id) ?? null : null;
}

/** A fresh object lets the editor modify examples without mutating the catalog. */
export function getGenerationTemplateDefaults(templateOrId: GenerationTemplate | string | null | undefined): Record<string, string> | null {
  const template = typeof templateOrId === "string" ? getGenerationTemplate(templateOrId) : templateOrId;
  if (!template) return null;
  return Object.fromEntries(template.fields.map(field => [field.id, template.defaultValues[field.id] ?? ""]));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Kind, category and every query term must intersect; existing order and item references are preserved. */
export function filterGenerationTemplates(
  filters: GenerationTemplateFilters = {}, templates: readonly GenerationTemplate[] = ACTIVE_GENERATION_TEMPLATES,
): readonly GenerationTemplate[] {
  const { kind, category } = filters;
  if (kind !== undefined && kind !== "all" && kind !== "image" && kind !== "video") return [];
  if (category !== undefined && category !== "all" && !isGenerationTemplateCategory(category)) return [];
  const query = normalize(typeof filters.query === "string" ? filters.query : "");
  const terms = query ? query.split(" ") : [];
  if ((!kind || kind === "all") && (!category || category === "all") && !terms.length) return templates;
  return templates.filter(template => {
    if (kind && kind !== "all" && template.kind !== kind) return false;
    if (category && category !== "all" && !template.categories.includes(category)) return false;
    const text = [template.label, template.englishLabel, template.description, ...template.tags,
      ...template.categories.map(id => getGenerationTemplateCategory(id)?.label ?? "")].map(normalize);
    return terms.every(term => text.some(field => field.includes(term)));
  });
}

export function fillGenerationTemplate(template: GenerationTemplate, values: Record<string, string>): string {
  if (template.fields.some(field => !values[field.id]?.trim())) throw new Error("请填写模板中的每个字段。");
  const result = template.pattern.replace(/\{\{([a-z]+)\}\}/g, (_, id: string) => values[id].trim());
  if (result.length > 4000) throw new Error("模板内容过长，请缩短字段后再试。");
  return result;
}
