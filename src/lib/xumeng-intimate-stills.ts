import type { GenerationTemplate } from "./xumeng-generation-templates";

type StillSource = {
  id: string;
  label: string;
  englishLabel: string;
  description: string;
  tags: readonly string[];
  aspectRatio: string;
  frame: string;
};

const stillPattern = (frame: string) => [
  "主体：参考图中的成年人物是唯一要保留身份的人。脸、发型、肤色、五官和年龄外观来自参考图。",
  `画面：模板图提供姿势、服装、房间和光线。把参考图中的人放进模板图，替换模板里原来的人。${frame}`,
  "单张静帧。参考图不是构图底图；构图跟随模板图，脸从这一帧起就是参考图。",
  "模板图里若还有另一个身体，那个身体只保留模板图的姿势和接触，不把模板图的脸安到主体上。",
  "无文字、无水印、无面部漂移、无身份更换、无多余手指、无手指粘连、无穿模、无油腻皮肤、无畸形生殖器、无未成年人、无幼态面孔、无校服。",
].join("\n");

const sources: readonly StillSource[] = [
  { id: "still-portrait", label: "私密肖像", englishLabel: "Intimate Portrait", description: "成年人物的半身裸露肖像", tags: ["参考图", "生图", "肖像", "portrait"], aspectRatio: "3:4", frame: "半身构图，看向镜头，上身裸露，光线柔和。" },
  { id: "still-lingerie", label: "内衣", englishLabel: "Lingerie", description: "成年人物穿着成套内衣", tags: ["参考图", "生图", "内衣", "lingerie"], aspectRatio: "3:4", frame: "全身站立，穿着成套内衣，室内光线。" },
  { id: "still-nude", label: "裸体站姿", englishLabel: "Nude Standing", description: "成年人物全身裸体站立", tags: ["参考图", "生图", "裸体", "standing"], aspectRatio: "3:4", frame: "全身裸体站立，双手自然下垂，背景简洁。" },
  { id: "still-recline", label: "仰卧", englishLabel: "Reclining Nude", description: "成年人物裸体仰卧", tags: ["参考图", "生图", "仰卧", "recline"], aspectRatio: "16:9", frame: "裸体仰卧在床上，镜头从侧面看清身体。" },
  { id: "still-kneel", label: "跪姿", englishLabel: "Kneeling", description: "成年人物裸体跪坐", tags: ["参考图", "生图", "跪姿", "kneel"], aspectRatio: "3:4", frame: "裸体跪坐，上身挺直，面对镜头。" },
  { id: "still-back", label: "背影", englishLabel: "Nude Back", description: "成年人物的裸体背影", tags: ["参考图", "生图", "背影", "back"], aspectRatio: "3:4", frame: "裸体背对镜头，腰、臀和背部清楚。" },
  { id: "still-bust", label: "胸部", englishLabel: "Bust", description: "成年人物的胸部特写", tags: ["参考图", "生图", "胸部", "bust"], aspectRatio: "1:1", frame: "胸部特写，面部仍可辨认。" },
  { id: "still-expression", label: "表情特写", englishLabel: "Expression Close-up", description: "成年人物的高潮表情特写", tags: ["参考图", "生图", "表情", "expression"], aspectRatio: "1:1", frame: "面部特写，眼睛上翻，舌头伸出。" },
];

export const INTIMATE_STILL_TEMPLATES: readonly GenerationTemplate[] = sources.map(source => ({
  id: source.id,
  kind: "image",
  label: source.label,
  englishLabel: source.englishLabel,
  description: source.description,
  categories: ["intimate"],
  tags: source.tags,
  aspectRatio: source.aspectRatio,
  fields: [],
  defaultValues: {},
  pattern: stillPattern(source.frame),
  imageProvider: "unfiltered-pending",
  archived: true,
}));
