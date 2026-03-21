import {
  DEFAULT_GENERATION_CONFIG,
  type NodeGenerationConfig,
} from "./video-generation";
import {
  DEFAULT_CHARACTER_IMAGE_MODEL,
  type ImageGenerationModel,
} from "./image-generation";
import {
  buildTransitionEdge,
  createConditionVariable,
  createSceneDefinition,
  createSceneAction,
  createVideoSceneNode,
  type CharacterDefinition,
  type EditorFlowEdge,
  type EditorFlowNode,
  type SceneAction,
  type SceneDefinition,
} from "../components/editor/project";

export type AgentCharacterDraft = {
  id: string;
  name: string;
  bio: string;
  appearancePrompt: string;
  basePrompt: string;
  imageModel: ImageGenerationModel;
};

export type AgentSceneDraft = {
  id: string;
  title: string;
  summary: string;
  branchId: string;
  durationSec: number;
  involvedCharacterIds: string[];
  actions: SceneAction[];
  videoPrompt: string;
};

export type AgentScenePresetDraft = {
  id: string;
  name: string;
  description: string;
  appearancePrompt: string;
  basePrompt: string;
  imageModel: ImageGenerationModel;
};

export type AgentTransitionDraft = {
  id: string;
  sourceSceneId: string;
  targetSceneId: string;
  conditionVariable: string;
  choiceLabel: string;
};

export type AgentBranchDraft = {
  id: string;
  name: string;
  predictedOutcome: string;
  tone: string;
};

export type AgentDraft = {
  id: string;
  storyTitle: string;
  sourceText: string;
  feedback: string;
  summary: string;
  characters: AgentCharacterDraft[];
  scenePresets: AgentScenePresetDraft[];
  scenes: AgentSceneDraft[];
  transitions: AgentTransitionDraft[];
  branches: AgentBranchDraft[];
};

export type AgentScreenplay = {
  title: string;
  logline: string;
  script: string;
};

const DEFAULT_IMAGE_MODEL = DEFAULT_CHARACTER_IMAGE_MODEL;
const FALLBACK_CHARACTER_NAMES = ["主角", "对手", "同伴"];
const ROLE_HINTS = [
  "主角",
  "女主",
  "男主",
  "反派",
  "对手",
  "同伴",
  "父亲",
  "母亲",
  "儿子",
  "女儿",
  "老师",
  "学生",
  "警察",
  "医生",
  "司机",
  "记者",
  "老板",
  "上司",
  "助理",
  "秘书",
  "代表",
];
const BLOCKED_CHARACTER_PREFIXES = [
  "在",
  "从",
  "向",
  "把",
  "将",
  "给",
  "和",
  "与",
  "被",
  "让",
  "对",
  "往",
  "由",
  "于",
  "按",
  "朝",
  "为",
  "因",
  "当",
  "若",
  "如",
];
const BLOCKED_CHARACTER_WORDS = [
  "全部",
  "冷笑",
  "笑着",
  "立刻",
  "必须",
  "决定",
  "留下",
  "面对",
  "真相",
  "发车",
  "随后",
  "然后",
  "最终",
  "突然",
  "已经",
  "仍然",
  "继续",
  "开始",
  "结束",
  "故事",
  "镜头",
  "画面",
  "雨夜",
  "车站",
  "上车",
  "下车",
  "选择",
  "片段",
  "现场",
];
const ACTION_VERB_PATTERN =
  "说|看|走|站|冲|拿|问|回头|推开|拉住|盯着|沉默|转身|追上|阻止|打开|关上|停下|答应|拒绝";
const CHARACTER_PROFILE_PRESETS: Array<{
  match: RegExp;
  bio: string;
  appearance: string;
  basePrompt: string;
}> = [
  {
    match: /父亲|爸爸/,
    bio: "中年父亲，情绪克制但内心有压力，是推动家庭抉择的重要人物。",
    appearance: "40 岁上下的东亚男性，短发，略显疲惫，穿深色衬衫或旧夹克，真实生活质感，面部轮廓清晰",
    basePrompt: "保持中年父亲的年龄感、短发和深色日常服装一致，写实电影感，避免夸张造型。",
  },
  {
    match: /母亲|妈妈/,
    bio: "中年母亲，外表平静但情绪层次明显，是家庭关系里的关键支点。",
    appearance: "40 岁上下的东亚女性，发型利落，穿低饱和日常服装，真实生活质感，神情克制",
    basePrompt: "保持中年母亲的面部、发型和家常服装一致，写实短剧风格，避免妆容过重。",
  },
  {
    match: /女主|姐姐|妹妹|女儿/,
    bio: "年轻女性主角，情绪有层次，具备明显辨识度，适合承担主视角表演。",
    appearance: "20 到 30 岁的东亚女性，五官清晰，发型稳定，穿简洁但有记忆点的服装，电影感人像",
    basePrompt: "保持年轻女性主角的发型、服装和年龄感一致，镜头写实自然，适合连续剧情。",
  },
  {
    match: /男主|哥哥|弟弟|儿子/,
    bio: "年轻男性主角，表演张力明确，适合承担连续剧情中的核心决策。",
    appearance: "20 到 30 岁的东亚男性，短发，脸部辨识度高，穿简洁有记忆点的服装，电影感写实",
    basePrompt: "保持年轻男性主角的发型、服装和年龄感一致，写实电影感，避免过度夸张。",
  },
  {
    match: /警察|医生|老师|记者|司机|老板|上司|助理|秘书|代表/,
    bio: "职业角色，身份清晰，造型应一眼看出职业属性，方便后续镜头复用。",
    appearance: "东亚写实人物，职业特征明确，服装干净利落，面部清晰，适合作为连续剧情角色参考图",
    basePrompt: "保持职业角色的服装轮廓、职业道具和年龄感一致，写实短剧风格。",
  },
];
const RANDOM_TITLE_PREFIXES = ["深夜", "逆流", "空站", "回声", "断桥", "沉默", "最后", "失控"];
const RANDOM_TITLE_SUFFIXES = ["来电", "末班车", "证词", "追踪", "转身", "选择", "余温", "夜航"];
const RANDOM_SETTINGS = [
  "暴雨中的高铁站",
  "凌晨还亮着灯的县城医院",
  "即将拆迁的旧居民楼",
  "封闭排练前夜的剧院后台",
  "信号时断时续的海边旅馆",
  "只剩最后一班渡轮的港口",
];
const RANDOM_GOALS = [
  "在最后时限前找到失联的人",
  "拿回一份会改变命运的证据",
  "阻止一场已经开始发酵的误会",
  "确认一个多年未解的秘密是否为真",
  "在众人到场前完成一次危险交易",
];
const RANDOM_TWISTS = [
  "对方其实早已设下试探",
  "真正的线索藏在一段被删掉的录音里",
  "主角一直相信的人正在撒谎",
  "关键人物比预想中更早赶到现场",
  "过去的一次选择正在反噬现在",
];
const RANDOM_CHOICE_PAIRS = [
  {
    main: "立刻追出去，赌一把还有挽回机会",
    alt: "留下来核对真相，哪怕错过眼前的人",
  },
  {
    main: "当众说出秘密，逼所有人表态",
    alt: "先按下不说，独自确认最后的证据",
  },
  {
    main: "相信面前的人，跟对方一起冒险",
    alt: "拒绝合作，改走更稳妥的路",
  },
  {
    main: "继续执行原计划",
    alt: "临时改道，转向另一条更危险的支线",
  },
];
const RANDOM_ROLE_GROUPS: Array<{
  lead: string;
  counterpart: string;
  observer?: string;
}> = [
  { lead: "父亲", counterpart: "儿子", observer: "警察" },
  { lead: "女主", counterpart: "母亲", observer: "记者" },
  { lead: "男主", counterpart: "妹妹", observer: "医生" },
  { lead: "警察", counterpart: "司机", observer: "记者" },
  { lead: "老师", counterpart: "学生", observer: "母亲" },
];

type LocalScenePlan = {
  scenes: AgentSceneDraft[];
  trunkSceneIds: string[];
};

const REFERENCE_LANE_CHARACTER_X = -520;
const REFERENCE_LANE_SCENE_X = -180;
const REFERENCE_LANE_START_Y = 84;
const REFERENCE_LANE_GAP_Y = 244;

function buildReferenceLanePosition(
  type: "character" | "scene",
  index: number,
) {
  return {
    x: type === "character" ? REFERENCE_LANE_CHARACTER_X : REFERENCE_LANE_SCENE_X,
    y: REFERENCE_LANE_START_Y + Math.max(index, 0) * REFERENCE_LANE_GAP_Y,
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function slugify(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "draft";
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.trim();

    if (normalized.length === 0 || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);

    return true;
  });
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function toSentenceList(storyText: string) {
  return storyText
    .split(/[\n。！？!?；;]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function inferEmotion(sentence: string) {
  if (/[哭痛崩绝望]/.test(sentence)) {
    return "痛苦";
  }

  if (/[怒冲吼杀追]/.test(sentence)) {
    return "激烈";
  }

  if (/[疑怕犹豫紧张]/.test(sentence)) {
    return "紧张";
  }

  if (/[笑暖轻松安心]/.test(sentence)) {
    return "温和";
  }

  return "克制";
}

function guessStoryTitle(storyText: string) {
  const firstLine = storyText.split("\n").find((item) => item.trim().length > 0);

  if (!firstLine) {
    return "互动故事草案";
  }

  return firstLine.trim().slice(0, 24);
}

function cleanCharacterCandidate(candidate: string, explicit = false) {
  const value = candidate
    .trim()
    .replace(/[“”"'`《》【】「」]/g, "")
    .replace(/\s+/g, "")
    .replace(/^(年轻的|年迈的|中年的|本方|对方)/, "")
    .replace(/(全部|之一)$/g, "");

  if (!value) {
    return undefined;
  }

  if (!explicit && BLOCKED_CHARACTER_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return undefined;
  }

  if (!explicit && BLOCKED_CHARACTER_WORDS.some((word) => value.includes(word))) {
    return undefined;
  }

  if (!explicit && value.length > 4) {
    return undefined;
  }

  if (value.length < 2) {
    return undefined;
  }

  if (/^[0-9_]+$/.test(value)) {
    return undefined;
  }

  return value;
}

function extractCharacterNames(storyText: string) {
  const candidates: string[] = [];
  const mentionMatches = storyText.matchAll(/@([\u4e00-\u9fa5A-Za-z0-9_]{1,16})/g);
  const appendCandidate = (candidate: string | undefined, explicit = false) => {
    const nextValue = candidate ? cleanCharacterCandidate(candidate, explicit) : undefined;

    if (!nextValue || candidates.includes(nextValue)) {
      return;
    }

    candidates.push(nextValue);
  };

  for (const match of mentionMatches) {
    appendCandidate(match[1], true);
  }

  for (const hint of ROLE_HINTS) {
    if (storyText.includes(hint)) {
      appendCandidate(hint, true);
    }
  }

  const namedMatches = storyText.matchAll(/(?:叫|名叫|名为|作为|身为)([\u4e00-\u9fa5]{2,4})/g);

  for (const match of namedMatches) {
    appendCandidate(match[1]);
  }

  const actionMatches = storyText.matchAll(
    new RegExp(`([\\u4e00-\\u9fa5]{2,4})(?=${ACTION_VERB_PATTERN})`, "g"),
  );

  for (const match of actionMatches) {
    appendCandidate(match[1]);
  }

  if (candidates.length === 0) {
    for (const fallback of FALLBACK_CHARACTER_NAMES) {
      appendCandidate(fallback, true);
    }
  }

  return candidates.slice(0, 4);
}

function buildCharacterProfile(name: string) {
  const preset = CHARACTER_PROFILE_PRESETS.find((item) => item.match.test(name));

  if (preset) {
    return {
      bio: `${name}：${preset.bio}`,
      appearancePrompt: `${name}，${preset.appearance}，单人角色设定图，写实电影感，正脸清晰，适合作为图生视频参考图。`,
      basePrompt: `保持 ${name} 的角色一致性。${preset.basePrompt}`,
    };
  }

  return {
    bio: `${name}：东亚写实人物，身份清晰，情绪层次明确，适合作为互动影视里的固定角色。`,
    appearancePrompt: `${name}，东亚写实人物，面部辨识度高，发型稳定，穿简洁但有记忆点的服装，单人角色设定图，电影感人像。`,
    basePrompt: `保持 ${name} 的面部、发型、服装和年龄感一致，写实短剧风格，避免多人同框。`,
  };
}

function createCharacterDrafts(storyText: string) {
  return extractCharacterNames(storyText).map((name, index) => {
    const id = slugify(name || `character_${index + 1}`);
    const profile = buildCharacterProfile(name || `角色 ${index + 1}`);

    return {
      id,
      name: name || `角色 ${index + 1}`,
      bio: profile.bio,
      appearancePrompt: profile.appearancePrompt,
      basePrompt: profile.basePrompt,
      imageModel: DEFAULT_IMAGE_MODEL,
    };
  });
}

function buildActionDraft(sentence: string, characterId: string) {
  return createSceneAction({
    characterId,
    action: sentence.slice(0, 36),
    emotion: inferEmotion(sentence),
    dialogue: "",
  });
}

function buildSceneTitle(sentence: string, index: number) {
  const normalized = sentence
    .replace(/[：:]/g, "，")
    .split(/[，。！？!?；;]/)[0]
    ?.trim();

  return normalized && normalized.length > 0
    ? normalized.slice(0, 12)
    : `片段 ${index + 1}`;
}

function buildScenePrompt(
  scene: AgentSceneDraft,
  branchName: string,
  characterNameMap: Map<string, string>,
) {
  const characterLine =
    scene.involvedCharacterIds.length > 0
      ? `角色: ${scene.involvedCharacterIds
          .map((characterId) => characterNameMap.get(characterId) ?? characterId)
          .join(", ")}`
      : "角色: 未指定";

  return [
    `分支: ${branchName}`,
    `镜头: ${scene.title}`,
    characterLine,
    `画面内容: ${scene.summary}`,
    "电影感，镜头语言清晰，适合互动影视节点。",
  ].join("\n");
}

function sanitizeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function sanitizeImageModel(value: unknown): ImageGenerationModel {
  return value === "doubao-seedream-5-0-260128" ||
    value === "doubao-seedream-4-5-251128" ||
    value === "doubao-seedream-4-0-250828" ||
    value === "doubao-seedream-3-0-t2i-250415"
    ? value
    : DEFAULT_IMAGE_MODEL;
}

function dedupeScenePresets(scenePresets: AgentScenePresetDraft[]) {
  const seen = new Set<string>();

  return scenePresets.filter((scenePreset) => {
    const key = `${scenePreset.name}::${scenePreset.description}`.trim().toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildScenePresetDescription(summary: string) {
  const match = summary.match(/在([^，。；]+?)(?:里|中|内|上|旁|前|后|时|，|。|；|$)/);

  if (match?.[1]) {
    return `${match[1]}，叙事中的关键环境，需要保持空间气质和光线连续。`;
  }

  return `${summary}，作为剧情中的关键场景参考，需要保持环境和氛围一致。`;
}

function buildScenePresetDrafts(
  storyText: string,
  scenes: AgentSceneDraft[],
  branches: AgentBranchDraft[],
): AgentScenePresetDraft[] {
  const presets = scenes.slice(0, 5).map((scene, index) => {
    const branch = branches.find((item) => item.id === scene.branchId);
    const description =
      scene.summary.trim().length > 0
        ? scene.summary.trim()
        : buildScenePresetDescription(storyText);

    return {
      id: `scene_preset_${index + 1}`,
      name:
        scene.title.replace(/^片段[:：\s-]*/g, "").trim() || `场景预设 ${index + 1}`,
      description,
      appearancePrompt: `${description}，${branch?.tone ?? "电影感"}氛围，环境设定图，空间构图明确，光线与色调稳定。`,
      basePrompt: `${description}，保持场景布局、材质和时间段一致，适合作为互动影视环境参考图。`,
      imageModel: DEFAULT_IMAGE_MODEL,
    } satisfies AgentScenePresetDraft;
  });

  if (presets.length > 0) {
    return dedupeScenePresets(presets);
  }

  return [
    {
      id: "scene_preset_1",
      name: "主场景",
      description: buildScenePresetDescription(storyText),
      appearancePrompt: `${buildScenePresetDescription(storyText)}，环境设定图，电影感氛围，稳定构图。`,
      basePrompt: "保持主场景的空间布局、色调和时间氛围一致，适合作为互动影视场景参考图。",
      imageModel: DEFAULT_IMAGE_MODEL,
    },
  ];
}

function pickReferenceSceneIds(
  scene: AgentSceneDraft,
  scenePresets: AgentScenePresetDraft[],
) {
  const haystack = `${scene.title} ${scene.summary} ${scene.videoPrompt}`.toLowerCase();
  const scored = scenePresets
    .map((scenePreset) => {
      const keywords = `${scenePreset.name} ${scenePreset.description}`
        .toLowerCase()
        .split(/[\s，。；、,:：\-]+/g)
        .filter((token) => token.length >= 2);
      const score = keywords.reduce(
        (total, token) => (haystack.includes(token) ? total + 1 : total),
        0,
      );

      return {
        id: scenePreset.id,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const matched = scored.filter((item) => item.score > 0).slice(0, 2).map((item) => item.id);

  if (matched.length > 0) {
    return matched;
  }

  return scenePresets[0] ? [scenePresets[0].id] : [];
}

function extractJsonBlock(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]+?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

export function normalizeAgentDraft(
  value: unknown,
  input: { storyText: string; feedback?: string },
): AgentDraft {
  if (!isRecord(value)) {
    return createLocalAgentDraft(input);
  }

  const baseDraft = createLocalAgentDraft(input);
  const characters = Array.isArray(value.characters)
    ? value.characters
        .map((item, index) => {
          if (!isRecord(item)) {
            return null;
          }

          const name = sanitizeString(item.name, `角色 ${index + 1}`);
          const id = slugify(sanitizeString(item.id, name));

          return {
            id,
            name,
            bio: sanitizeString(item.bio, `${name}，在故事里承担关键抉择与情绪推动。`),
            appearancePrompt: sanitizeString(
              item.appearancePrompt,
              `${name}，电影感写实人物，服装稳定，面部辨识度高。`,
            ),
            basePrompt: sanitizeString(
              item.basePrompt,
              `保持 ${name} 的面部和服装一致性。`,
            ),
            imageModel: sanitizeImageModel(item.imageModel),
          } satisfies AgentCharacterDraft;
        })
        .filter((item): item is AgentCharacterDraft => Boolean(item))
    : baseDraft.characters;
  const draftScenePresets = Array.isArray(value.scenePresets)
    ? value.scenePresets
        .map((item, index) => {
          if (!isRecord(item)) {
            return null;
          }

          const name = sanitizeString(item.name, `场景预设 ${index + 1}`);

          return {
            id: slugify(sanitizeString(item.id, name)),
            name,
            description: sanitizeString(
              item.description,
              `${name}，作为剧情环境参考，需要保持空间与氛围一致。`,
            ),
            appearancePrompt: sanitizeString(
              item.appearancePrompt,
              `${name}，环境设定图，空间与光线明确，电影感写实。`,
            ),
            basePrompt: sanitizeString(
              item.basePrompt,
              `保持 ${name} 的场景布局、光线和材质一致。`,
            ),
            imageModel: sanitizeImageModel(item.imageModel),
          } satisfies AgentScenePresetDraft;
        })
        .filter((item): item is AgentScenePresetDraft => Boolean(item))
    : baseDraft.scenePresets;

  const characterIds = new Set(characters.map((item) => item.id));
  const branches = Array.isArray(value.branches)
    ? value.branches
        .map((item, index) => {
          if (!isRecord(item)) {
            return null;
          }

          return {
            id: sanitizeString(item.id, `branch_${index + 1}`),
            name: sanitizeString(item.name, `分支 ${index + 1}`),
            predictedOutcome: sanitizeString(item.predictedOutcome, "等待补充。"),
            tone: sanitizeString(item.tone, "稳定"),
          } satisfies AgentBranchDraft;
        })
        .filter((item): item is AgentBranchDraft => Boolean(item))
    : baseDraft.branches;

  const branchIds = new Set(branches.map((item) => item.id));
  const draftScenes = Array.isArray(value.scenes)
    ? value.scenes
        .map((item, index) => {
          if (!isRecord(item)) {
            return null;
          }

          const involvedCharacterIds = Array.isArray(item.involvedCharacterIds)
            ? item.involvedCharacterIds
                .map((characterId) => sanitizeString(characterId))
                .filter((characterId) => characterIds.has(characterId))
            : [];
          const fallbackCharacterIds =
            involvedCharacterIds.length > 0
              ? involvedCharacterIds
              : characters.slice(0, Math.min(2, characters.length)).map((character) => character.id);
          const actions = Array.isArray(item.actions)
            ? item.actions
                .map((actionItem) => {
                  if (!isRecord(actionItem)) {
                    return null;
                  }

                  const characterId = sanitizeString(
                    actionItem.characterId,
                    fallbackCharacterIds[0] ?? "",
                  );

                  return createSceneAction({
                    characterId: characterIds.has(characterId)
                      ? characterId
                      : fallbackCharacterIds[0] ?? "",
                    action: sanitizeString(actionItem.action),
                    emotion: sanitizeString(actionItem.emotion),
                    dialogue: sanitizeString(actionItem.dialogue),
                  });
                })
                .filter((action): action is SceneAction => Boolean(action))
            : fallbackCharacterIds.map((characterId) =>
                createSceneAction({
                  characterId,
                  action: sanitizeString(item.summary, "推进剧情"),
                  emotion: "克制",
                  dialogue: "",
                }),
              );

          return {
            id: sanitizeString(item.id, `scene_${index + 1}`),
            title: sanitizeString(item.title, buildSceneTitle(sanitizeString(item.summary), index)),
            summary: sanitizeString(item.summary, "待补充镜头内容。"),
            branchId: branchIds.has(sanitizeString(item.branchId))
              ? sanitizeString(item.branchId)
              : branches[0]?.id ?? "main",
            durationSec:
              typeof item.durationSec === "number" && Number.isFinite(item.durationSec)
                ? Math.max(3, Math.min(12, item.durationSec))
                : 5,
            involvedCharacterIds: fallbackCharacterIds,
            actions,
            videoPrompt: sanitizeString(item.videoPrompt, ""),
          } satisfies AgentSceneDraft;
        })
        .filter((item): item is AgentSceneDraft => Boolean(item))
    : baseDraft.scenes;
  const sceneCharacterNameMap = new Map(
    characters.map((character) => [character.id, character.name]),
  );
  const scenes = (draftScenes.length > 0 ? draftScenes : baseDraft.scenes).map((scene, index) => {
    const involvedCharacterIds =
      scene.involvedCharacterIds.length > 0
        ? dedupeStrings(scene.involvedCharacterIds).filter((characterId) => characterIds.has(characterId))
        : characters.slice(0, Math.min(2, characters.length)).map((character) => character.id);
    const summary =
      scene.summary.trim().length > 0 ? scene.summary.trim() : `镜头 ${index + 1} 推进剧情。`;
    const actions =
      scene.actions.length > 0
        ? scene.actions.map((action) =>
            createSceneAction({
              ...action,
              characterId:
                characterIds.has(action.characterId) ? action.characterId : involvedCharacterIds[0] ?? "",
              action: action.action.trim().length > 0 ? action.action : summary,
              emotion: action.emotion.trim(),
              dialogue: action.dialogue.trim(),
            }),
          )
        : involvedCharacterIds.map((characterId) => buildActionDraft(summary, characterId));
    const nextScene = {
      ...scene,
      title: scene.title.trim().length > 0 ? scene.title.trim() : buildSceneTitle(summary, index),
      summary,
      branchId: branchIds.has(scene.branchId) ? scene.branchId : branches[0]?.id ?? "main",
      involvedCharacterIds,
      actions,
    } satisfies AgentSceneDraft;
    const branch = branches.find((item) => item.id === nextScene.branchId) ?? branches[0];

    return {
      ...nextScene,
      videoPrompt:
        nextScene.videoPrompt.trim().length > 0
          ? nextScene.videoPrompt.trim()
          : buildScenePrompt(nextScene, branch?.name ?? nextScene.branchId, sceneCharacterNameMap),
    } satisfies AgentSceneDraft;
  });

  const sceneIds = new Set(scenes.map((item) => item.id));
  const draftTransitions = Array.isArray(value.transitions)
    ? value.transitions
        .map((item, index) => {
          if (!isRecord(item)) {
            return null;
          }

          const sourceSceneId = sanitizeString(item.sourceSceneId);
          const targetSceneId = sanitizeString(item.targetSceneId);

          if (!sceneIds.has(sourceSceneId) || !sceneIds.has(targetSceneId)) {
            return null;
          }

          return {
            id: sanitizeString(item.id, `transition_${index + 1}`),
            sourceSceneId,
            targetSceneId,
            conditionVariable: sanitizeString(
              item.conditionVariable,
              createConditionVariable(index + 1),
            ),
            choiceLabel: sanitizeString(item.choiceLabel, "继续"),
          } satisfies AgentTransitionDraft;
        })
        .filter((item): item is AgentTransitionDraft => Boolean(item))
    : baseDraft.transitions;
  const transitions = hasValidTreeTransitions(scenes, draftTransitions)
    ? draftTransitions
    : createFallbackTransitions(scenes, branches.length > 0 ? branches : baseDraft.branches);

  return {
    id: sanitizeString(value.id, crypto.randomUUID()),
    storyTitle: sanitizeString(value.storyTitle, baseDraft.storyTitle),
    sourceText: input.storyText.trim(),
    feedback: input.feedback?.trim() ?? "",
    summary: sanitizeString(value.summary, baseDraft.summary),
    characters: characters.length > 0 ? characters : baseDraft.characters,
    scenePresets:
      draftScenePresets.length > 0
        ? dedupeScenePresets(draftScenePresets)
        : baseDraft.scenePresets,
    scenes: scenes.length > 0 ? scenes : baseDraft.scenes,
    transitions,
    branches: branches.length > 0 ? branches : baseDraft.branches,
  };
}

export function normalizeAgentDraftFromText(
  text: string,
  input: { storyText: string; feedback?: string },
): AgentDraft {
  const candidate = extractJsonBlock(text);

  try {
    return normalizeAgentDraft(JSON.parse(candidate), input);
  } catch {
    return createLocalAgentDraft(input);
  }
}

export function createLocalAgentScreenplay(input: {
  storyText: string;
  feedback?: string;
  draft?: AgentDraft | null;
}): AgentScreenplay {
  const draft = input.draft ?? createLocalAgentDraft(input);
  const characterIndex = new Map(draft.characters.map((character) => [character.id, character]));
  const outgoingBySceneId = new Map<string, AgentTransitionDraft[]>();

  for (const scene of draft.scenes) {
    outgoingBySceneId.set(scene.id, []);
  }

  for (const transition of draft.transitions) {
    outgoingBySceneId.get(transition.sourceSceneId)?.push(transition);
  }

  const sceneBlocks = draft.scenes.map((scene, index) => {
    const branch = draft.branches.find((item) => item.id === scene.branchId);
    const actionLines =
          scene.actions.length > 0
        ? scene.actions
            .map((action) => {
              const character = characterIndex.get(action.characterId);
              const identity = character?.name ?? action.characterId ?? "未命名角色";
              const dialogue = action.dialogue.trim().length > 0 ? `；台词：${action.dialogue.trim()}` : "";
              const emotion = action.emotion.trim().length > 0 ? `；情绪：${action.emotion.trim()}` : "";

              return `- ${identity}${emotion}；动作：${action.action.trim() || "推进剧情"}${dialogue}`;
            })
            .join("\n")
        : "- 画面推进剧情。";
    const transitions = outgoingBySceneId.get(scene.id) ?? [];
    const choiceLines =
      transitions.length > 0
        ? transitions
            .map((transition) => `- ${transition.choiceLabel}（${transition.conditionVariable}）`)
            .join("\n")
        : "- 无，进入收束或等待下一个镜头。";

    return [
      `【场 ${index + 1}｜${scene.title}】`,
      `分支：${branch?.name ?? scene.branchId}`,
      `画面：${scene.summary}`,
      "角色动作：",
      actionLines,
      "视频 Prompt：",
      scene.videoPrompt,
      "分支选择：",
      choiceLines,
    ].join("\n");
  });

  return {
    title: `${draft.storyTitle}｜互动剧本`,
    logline: draft.summary,
    script: [
      `标题：${draft.storyTitle}`,
      `一句话梗概：${draft.summary}`,
      "",
      "【角色设定】",
      ...draft.characters.map(
        (character) => `- ${character.name}（@${character.id}）：${character.bio}`,
      ),
      "",
      "【分支设计】",
      ...draft.branches.map(
        (branch) => `- ${branch.name}：${branch.predictedOutcome}｜基调：${branch.tone}`,
      ),
      "",
      "【分镜剧本】",
      ...sceneBlocks,
    ].join("\n"),
  };
}

export function normalizeAgentScreenplay(
  value: unknown,
  input: { storyText: string; feedback?: string; draft?: AgentDraft | null },
): AgentScreenplay {
  if (!isRecord(value)) {
    return createLocalAgentScreenplay(input);
  }

  const fallback = createLocalAgentScreenplay(input);

  return {
    title: sanitizeString(value.title, fallback.title),
    logline: sanitizeString(value.logline, fallback.logline),
    script: sanitizeString(value.script, fallback.script),
  };
}

export function normalizeAgentScreenplayFromText(
  text: string,
  input: { storyText: string; feedback?: string; draft?: AgentDraft | null },
): AgentScreenplay {
  const candidate = extractJsonBlock(text);

  try {
    return normalizeAgentScreenplay(JSON.parse(candidate), input);
  } catch {
    return {
      ...createLocalAgentScreenplay(input),
      script: text.trim().length > 0 ? text.trim() : createLocalAgentScreenplay(input).script,
    };
  }
}

export function createRandomStoryTemplate() {
  const roles = pickRandom(RANDOM_ROLE_GROUPS);
  const setting = pickRandom(RANDOM_SETTINGS);
  const goal = pickRandom(RANDOM_GOALS);
  const twist = pickRandom(RANDOM_TWISTS);
  const choices = pickRandom(RANDOM_CHOICE_PAIRS);
  const title = `${pickRandom(RANDOM_TITLE_PREFIXES)}${pickRandom(RANDOM_TITLE_SUFFIXES)}`;
  const observerLine = roles.observer
    ? `与此同时，${roles.observer}正在暗中盯着局势，随时可能打破平衡。`
    : "";

  return [
    `《${title}》`,
    `${roles.lead}在${setting}，必须${goal}。`,
    `${roles.counterpart}迟迟没有现身，现场只留下一个模糊但危险的提示，${twist}。`,
    observerLine,
    `关键选择：如果${roles.lead}${choices.main}，故事会沿主线推进；如果${roles.lead}${choices.alt}，故事会进入另一条支线。`,
    `请围绕${roles.lead}、${roles.counterpart}${roles.observer ? `、${roles.observer}` : ""}之间的关系，拆成可拍的互动影视故事。`,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function createBranchDrafts(sentences: string[]) {
  const hasChoice = sentences.some((sentence) => /选择|如果|否则|要么|或者|分支|是否|抉择|决定/.test(sentence));

  if (!hasChoice) {
    return [
      {
        id: "main",
        name: "主线",
        predictedOutcome: "按故事原始走向推进。",
        tone: "稳定推进",
      },
    ];
  }

  return [
    {
      id: "main",
      name: "继续主线",
      predictedOutcome: "角色维持当前决定，故事顺势推进。",
      tone: "推进",
    },
    {
      id: "branch_alt",
      name: "改走支线",
      predictedOutcome: "角色做出另一种选择，导向不同结果。",
      tone: "反转",
    },
  ];
}

function buildChoiceLabel(branch: AgentBranchDraft, branchIndex: number, totalBranches: number) {
  if (totalBranches <= 1) {
    return "继续";
  }

  if (branch.id === "main") {
    return "继续主线";
  }

  if (branch.id === "branch_alt") {
    return "改走支线";
  }

  return branch.name || `选项 ${branchIndex + 1}`;
}

function buildChoiceConditionVariable(
  branch: AgentBranchDraft,
  branchIndex: number,
  totalBranches: number,
) {
  if (totalBranches <= 1) {
    return `auto_continue_${branchIndex + 1}`;
  }

  const slug = slugify(branch.id || branch.name);

  return slug ? `choose_${slug}` : createConditionVariable(branchIndex + 1);
}

function buildContinueConditionVariable(sceneId: string, index: number) {
  const slug = slugify(sceneId);

  return slug ? `continue_${slug}_${index + 1}` : createConditionVariable(index + 1);
}

function buildSceneDraft(
  sentence: string,
  index: number,
  branchId: string,
  characters: AgentCharacterDraft[],
  branches: AgentBranchDraft[],
  feedback: string,
) {
  const characterNameMap = new Map(
    characters.map((character) => [character.id, character.name]),
  );
  const involvedCharacterIds = characters
    .filter((character) => sentence.includes(character.name))
    .map((character) => character.id);
  const normalizedCharacterIds =
    involvedCharacterIds.length > 0
      ? involvedCharacterIds
      : characters.slice(0, Math.min(2, characters.length)).map((character) => character.id);
  const summary =
    feedback.trim().length > 0 ? `${sentence}。修订意见：${feedback.trim()}` : sentence;
  const scene: AgentSceneDraft = {
    id: `scene_${index + 1}`,
    title: buildSceneTitle(sentence, index),
    summary,
    branchId,
    durationSec: 5,
    involvedCharacterIds: normalizedCharacterIds,
    actions: normalizedCharacterIds.map((characterId) =>
      buildActionDraft(sentence, characterId),
    ),
    videoPrompt: "",
  };
  const branch = branches.find((item) => item.id === branchId) ?? branches[0];

  return {
    ...scene,
    videoPrompt: buildScenePrompt(scene, branch?.name ?? branchId, characterNameMap),
  };
}

function createLocalScenePlan(
  storyText: string,
  feedback: string,
  characters: AgentCharacterDraft[],
  branches: AgentBranchDraft[],
): LocalScenePlan {
  const sentences = toSentenceList(storyText);
  const limited = sentences.slice(0, Math.max(3, Math.min(6, sentences.length)));
  const sceneSentences =
    limited.length > 0
      ? limited
      : ["故事开场，角色进入局势。", "冲突升级，角色被迫做出选择。", "结果显现，故事推进到下一个阶段。"];

  if (branches.length <= 1) {
    const scenes = sceneSentences.map((sentence, index) =>
      buildSceneDraft(sentence, index, branches[0]?.id ?? "main", characters, branches, feedback),
    );

    return {
      scenes,
      trunkSceneIds: scenes.map((scene) => scene.id),
    };
  }

  const minimumBranchScenes = branches.length;
  const trunkCount = Math.max(
    1,
    Math.min(2, sceneSentences.length - minimumBranchScenes),
  );
  const trunkSentences = sceneSentences.slice(0, trunkCount);
  const remainingSentences = sceneSentences.slice(trunkCount);
  const branchBuckets = new Map<string, string[]>(
    branches.map((branch) => [branch.id, []]),
  );

  remainingSentences.forEach((sentence, index) => {
    const branch = branches[index % branches.length];

    branchBuckets.get(branch.id)?.push(sentence);
  });

  for (const branch of branches) {
    const bucket = branchBuckets.get(branch.id) ?? [];

    if (bucket.length === 0) {
      bucket.push(
        branch.id === "main"
          ? "角色沿着原计划继续推进，情绪逐步升级。"
          : `${branch.name}展开，角色做出不同选择并承受新的结果。`,
      );
    }

    branchBuckets.set(branch.id, bucket);
  }

  const scenes: AgentSceneDraft[] = [];
  const trunkSceneIds: string[] = [];
  let sceneIndex = 0;

  trunkSentences.forEach((sentence) => {
    const scene = buildSceneDraft(
      sentence,
      sceneIndex,
      branches[0].id,
      characters,
      branches,
      feedback,
    );

    scenes.push(scene);
    trunkSceneIds.push(scene.id);
    sceneIndex += 1;
  });

  branches.forEach((branch) => {
    const bucket = branchBuckets.get(branch.id) ?? [];

    bucket.forEach((sentence) => {
      const scene = buildSceneDraft(
        sentence,
        sceneIndex,
        branch.id,
        characters,
        branches,
        feedback,
      );

      scenes.push(scene);
      sceneIndex += 1;
    });
  });

  return {
    scenes,
    trunkSceneIds,
  };
}

function createTransitionDraftsFromPlan(
  plan: LocalScenePlan,
  branches: AgentBranchDraft[],
) {
  if (plan.scenes.length <= 1) {
    return [];
  }

  const sceneMap = new Map(plan.scenes.map((scene) => [scene.id, scene]));
  const trunkSet = new Set(plan.trunkSceneIds);
  const transitions: AgentTransitionDraft[] = [];

  if (branches.length <= 1) {
    for (let index = 0; index < plan.scenes.length - 1; index += 1) {
      transitions.push({
        id: `transition_linear_${index + 1}`,
        sourceSceneId: plan.scenes[index].id,
        targetSceneId: plan.scenes[index + 1].id,
        conditionVariable: buildContinueConditionVariable(plan.scenes[index].id, index),
        choiceLabel: "继续",
      });
    }

    return transitions;
  }

  const trunkScenes = plan.trunkSceneIds
    .map((sceneId) => sceneMap.get(sceneId))
    .filter((scene): scene is AgentSceneDraft => Boolean(scene));

  for (let index = 0; index < trunkScenes.length - 1; index += 1) {
    transitions.push({
      id: `transition_trunk_${index + 1}`,
      sourceSceneId: trunkScenes[index].id,
      targetSceneId: trunkScenes[index + 1].id,
      conditionVariable: buildContinueConditionVariable(trunkScenes[index].id, index),
      choiceLabel: "继续",
    });
  }

  const branchSource = trunkScenes[trunkScenes.length - 1] ?? plan.scenes[0];
  const branchScenesById = new Map<string, AgentSceneDraft[]>(
    branches.map((branch) => [branch.id, []]),
  );

  plan.scenes.forEach((scene) => {
    if (trunkSet.has(scene.id)) {
      return;
    }

    branchScenesById.get(scene.branchId)?.push(scene);
  });

  branches.forEach((branch, branchIndex) => {
    const branchScenes = branchScenesById.get(branch.id) ?? [];

    if (branchScenes.length === 0) {
      return;
    }

    transitions.push({
      id: `transition_choice_${branch.id}`,
      sourceSceneId: branchSource.id,
      targetSceneId: branchScenes[0].id,
      conditionVariable: buildChoiceConditionVariable(branch, branchIndex, branches.length),
      choiceLabel: buildChoiceLabel(branch, branchIndex, branches.length),
    });

    for (let index = 0; index < branchScenes.length - 1; index += 1) {
      transitions.push({
        id: `transition_${branch.id}_${index + 1}`,
        sourceSceneId: branchScenes[index].id,
        targetSceneId: branchScenes[index + 1].id,
        conditionVariable: buildContinueConditionVariable(branchScenes[index].id, index),
        choiceLabel: "继续",
      });
    }
  });

  return transitions;
}

function hasValidTreeTransitions(
  scenes: AgentSceneDraft[],
  transitions: AgentTransitionDraft[],
) {
  if (scenes.length <= 1) {
    return true;
  }

  const incomingCount = new Map(scenes.map((scene) => [scene.id, 0]));
  const childMap = new Map(scenes.map((scene) => [scene.id, [] as string[]]));

  for (const transition of transitions) {
    if (!incomingCount.has(transition.sourceSceneId) || !incomingCount.has(transition.targetSceneId)) {
      return false;
    }

    incomingCount.set(
      transition.targetSceneId,
      (incomingCount.get(transition.targetSceneId) ?? 0) + 1,
    );

    if ((incomingCount.get(transition.targetSceneId) ?? 0) > 1) {
      return false;
    }

    childMap.get(transition.sourceSceneId)?.push(transition.targetSceneId);
  }

  const roots = scenes
    .filter((scene) => (incomingCount.get(scene.id) ?? 0) === 0)
    .map((scene) => scene.id);

  if (roots.length !== 1) {
    return false;
  }

  const visited = new Set<string>();
  const walk = (sceneId: string, stack = new Set<string>()) => {
    if (stack.has(sceneId)) {
      return false;
    }

    stack.add(sceneId);
    visited.add(sceneId);

    for (const childSceneId of childMap.get(sceneId) ?? []) {
      if (!walk(childSceneId, new Set(stack))) {
        return false;
      }
    }

    return true;
  };

  return walk(roots[0]) && visited.size === scenes.length;
}

function createFallbackTransitions(
  scenes: AgentSceneDraft[],
  branches: AgentBranchDraft[],
) {
  if (scenes.length <= 1) {
    return [];
  }

  const mainBranchId = branches[0]?.id ?? scenes[0]?.branchId ?? "main";
  const firstAltIndex = scenes.findIndex((scene) => scene.branchId !== mainBranchId);

  if (branches.length <= 1 || firstAltIndex === -1) {
    return scenes.slice(0, -1).map((scene, index) => ({
      id: `transition_fallback_${index + 1}`,
      sourceSceneId: scene.id,
      targetSceneId: scenes[index + 1].id,
      conditionVariable: buildContinueConditionVariable(scene.id, index),
      choiceLabel: "继续",
    }));
  }

  const trunkScenes = scenes.slice(0, Math.max(1, firstAltIndex));
  const branchSource = trunkScenes[trunkScenes.length - 1];
  const transitions = trunkScenes.slice(0, -1).map((scene, index) => ({
    id: `transition_fallback_trunk_${index + 1}`,
    sourceSceneId: scene.id,
    targetSceneId: trunkScenes[index + 1].id,
    conditionVariable: buildContinueConditionVariable(scene.id, index),
    choiceLabel: "继续",
  }));
  const groupedScenes = new Map<string, AgentSceneDraft[]>(
    branches.map((branch) => [branch.id, []]),
  );

  scenes.slice(trunkScenes.length).forEach((scene) => {
    groupedScenes.get(scene.branchId)?.push(scene);
  });

  branches.forEach((branch, branchIndex) => {
    const branchScenes = groupedScenes.get(branch.id) ?? [];

    if (branchScenes.length === 0) {
      return;
    }

    transitions.push({
      id: `transition_fallback_choice_${branch.id}`,
      sourceSceneId: branchSource.id,
      targetSceneId: branchScenes[0].id,
      conditionVariable: buildChoiceConditionVariable(branch, branchIndex, branches.length),
      choiceLabel: buildChoiceLabel(branch, branchIndex, branches.length),
    });

    for (let index = 0; index < branchScenes.length - 1; index += 1) {
      transitions.push({
        id: `transition_fallback_branch_${branch.id}_${index + 1}`,
        sourceSceneId: branchScenes[index].id,
        targetSceneId: branchScenes[index + 1].id,
        conditionVariable: buildContinueConditionVariable(branchScenes[index].id, index),
        choiceLabel: "继续",
      });
    }
  });

  return transitions;
}

export function createLocalAgentDraft(input: {
  storyText: string;
  feedback?: string;
}) {
  const storyText = input.storyText.trim();
  const feedback = input.feedback?.trim() ?? "";
  const characters = createCharacterDrafts(storyText);
  const summary = toSentenceList(storyText).slice(0, 3).join(" / ") || "等待故事输入";
  const branches = createBranchDrafts(toSentenceList(storyText));
  const scenePlan = createLocalScenePlan(storyText, feedback, characters, branches);
  const transitions = createTransitionDraftsFromPlan(scenePlan, branches);
  const scenePresets = buildScenePresetDrafts(storyText, scenePlan.scenes, branches);

  return {
    id: crypto.randomUUID(),
    storyTitle: guessStoryTitle(storyText),
    sourceText: storyText,
    feedback,
    summary,
    characters,
    scenePresets,
    scenes: scenePlan.scenes,
    transitions,
    branches,
  } satisfies AgentDraft;
}

export function applyAgentDraftToEditorGraph(draft: AgentDraft): {
  characters: CharacterDefinition[];
  scenes: SceneDefinition[];
  nodes: EditorFlowNode[];
  edges: EditorFlowEdge[];
} {
  const branchOrder = draft.branches.map((branch) => branch.id);
  const branchIndexMap = new Map(
    branchOrder.map((branchId, index) => [branchId, index]),
  );
  const sceneIndexMap = new Map(draft.scenes.map((scene, index) => [scene.id, index]));
  const incomingCount = new Map(draft.scenes.map((scene) => [scene.id, 0]));
  const childSceneMap = new Map<string, string[]>();

  for (const scene of draft.scenes) {
    childSceneMap.set(scene.id, []);
  }

  for (const transition of draft.transitions) {
    if (!sceneIndexMap.has(transition.sourceSceneId) || !sceneIndexMap.has(transition.targetSceneId)) {
      continue;
    }

    incomingCount.set(
      transition.targetSceneId,
      (incomingCount.get(transition.targetSceneId) ?? 0) + 1,
    );

    childSceneMap.get(transition.sourceSceneId)?.push(transition.targetSceneId);
  }

  const compareSceneIds = (sceneIdA: string, sceneIdB: string) => {
    const sceneA = draft.scenes[sceneIndexMap.get(sceneIdA) ?? 0];
    const sceneB = draft.scenes[sceneIndexMap.get(sceneIdB) ?? 0];
    const branchRankA = branchIndexMap.get(sceneA?.branchId ?? "") ?? Number.MAX_SAFE_INTEGER;
    const branchRankB = branchIndexMap.get(sceneB?.branchId ?? "") ?? Number.MAX_SAFE_INTEGER;

    if (branchRankA !== branchRankB) {
      return branchRankA - branchRankB;
    }

    return (sceneIndexMap.get(sceneIdA) ?? 0) - (sceneIndexMap.get(sceneIdB) ?? 0);
  };

  for (const childSceneIds of childSceneMap.values()) {
    childSceneIds.sort(compareSceneIds);
  }

  const rootSceneIds = draft.scenes
    .filter((scene) => (incomingCount.get(scene.id) ?? 0) === 0)
    .map((scene) => scene.id);

  if (rootSceneIds.length === 0 && draft.scenes[0]) {
    rootSceneIds.push(draft.scenes[0].id);
  }

  rootSceneIds.sort(compareSceneIds);
  const nodePositionMap = new Map<string, { x: number; y: number }>();
  const depthMap = new Map<string, number>();
  const subtreeLeafCount = new Map<string, number>();
  const leafCenterMap = new Map<string, number>();
  const NODE_X_GAP = 360;
  const ROOT_LAYER_Y = 80;
  const LAYER_Y_GAP = 300;
  const TREE_OFFSET_X = 560;
  const ROOT_GAP_LEAVES = 1;
  const computeSubtreeLeafCount = (sceneId: string, stack = new Set<string>()): number => {
    const cached = subtreeLeafCount.get(sceneId);

    if (cached) {
      return cached;
    }

    if (stack.has(sceneId)) {
      subtreeLeafCount.set(sceneId, 1);

      return 1;
    }

    const nextStack = new Set(stack);
    nextStack.add(sceneId);
    const childSceneIds = childSceneMap.get(sceneId) ?? [];

    if (childSceneIds.length === 0) {
      subtreeLeafCount.set(sceneId, 1);

      return 1;
    }

    const count = childSceneIds.reduce(
      (total, childSceneId) => total + computeSubtreeLeafCount(childSceneId, nextStack),
      0,
    );

    subtreeLeafCount.set(sceneId, Math.max(1, count));

    return Math.max(1, count);
  };
  const placeTree = (sceneId: string, startLeafIndex: number, depth: number) => {
    depthMap.set(sceneId, depth);

    const childSceneIds = childSceneMap.get(sceneId) ?? [];

    if (childSceneIds.length === 0) {
      const leafCenter = startLeafIndex;

      leafCenterMap.set(sceneId, leafCenter);
      nodePositionMap.set(sceneId, {
        x: TREE_OFFSET_X + leafCenter * NODE_X_GAP,
        y: ROOT_LAYER_Y + depth * LAYER_Y_GAP,
      });

      return 1;
    }

    let cursor = startLeafIndex;
    const childCenters: number[] = [];

    for (const childSceneId of childSceneIds) {
      const childWidth = computeSubtreeLeafCount(childSceneId);

      placeTree(childSceneId, cursor, depth + 1);
      childCenters.push(leafCenterMap.get(childSceneId) ?? cursor);
      cursor += childWidth;
    }

    const firstCenter = childCenters[0] ?? startLeafIndex;
    const lastCenter = childCenters[childCenters.length - 1] ?? startLeafIndex;
    const leafCenter = (firstCenter + lastCenter) / 2;

    leafCenterMap.set(sceneId, leafCenter);
    nodePositionMap.set(sceneId, {
      x: TREE_OFFSET_X + leafCenter * NODE_X_GAP,
      y: ROOT_LAYER_Y + depth * LAYER_Y_GAP,
    });

    return computeSubtreeLeafCount(sceneId);
  };
  let startLeafIndex = 0;

  rootSceneIds.forEach((sceneId, index) => {
    placeTree(sceneId, startLeafIndex, 0);
    startLeafIndex += computeSubtreeLeafCount(sceneId);

    if (index < rootSceneIds.length - 1) {
      startLeafIndex += ROOT_GAP_LEAVES;
    }
  });

  const characters: CharacterDefinition[] = draft.characters.map((character, index) => ({
    id: character.id,
    name: character.name,
    bio: dedupeStrings([character.bio, character.appearancePrompt]).join("\n"),
    basePrompt: character.basePrompt,
    imageModel: character.imageModel,
    referenceImageAssetRefs: [],
    canvasPinned: true,
    canvasPosition: buildReferenceLanePosition("character", index),
  }));
  const scenes: SceneDefinition[] = draft.scenePresets.map((scenePreset, index) =>
    createSceneDefinition(index + 1, {
      id: scenePreset.id,
      name: scenePreset.name,
      description: [scenePreset.description, scenePreset.appearancePrompt]
        .filter((item) => item.trim().length > 0)
        .join("\n"),
      basePrompt: scenePreset.basePrompt,
      imageModel: scenePreset.imageModel,
      referenceImageAssetRefs: [],
      canvasPinned: true,
      canvasPosition: buildReferenceLanePosition("scene", index),
    }),
  );

  const sceneNodeMap = new Map<string, EditorFlowNode>();
  const sceneOrderMap = new Map<string, number>();

  const nodes = draft.scenes.map((scene, index) => {
    const node = createVideoSceneNode(
      nodePositionMap.get(scene.id) ?? { x: 120, y: 120 + index * 260 },
      {
        title: scene.title,
        shotNotes: scene.summary,
        actions: scene.actions,
        generation: {
          ...DEFAULT_GENERATION_CONFIG,
          durationSec: scene.durationSec,
          promptOverride: scene.videoPrompt,
          referenceCharacterIds: [...scene.involvedCharacterIds],
          referenceSceneIds: pickReferenceSceneIds(scene, draft.scenePresets),
        } satisfies NodeGenerationConfig,
      },
    );

    sceneNodeMap.set(scene.id, node);
    sceneOrderMap.set(scene.id, index);

    return node;
  });

  const edges = draft.transitions
    .map((transition) => {
      const source = sceneNodeMap.get(transition.sourceSceneId);
      const target = sceneNodeMap.get(transition.targetSceneId);

      if (!source || !target) {
        return null;
      }

      return buildTransitionEdge({
        source: source.id,
        target: target.id,
        conditionVariable: transition.conditionVariable,
        choiceLabel: transition.choiceLabel,
      });
    })
    .filter((edge): edge is EditorFlowEdge => Boolean(edge))
    .sort((edgeA, edgeB) => {
      const sourceOrderA = sceneOrderMap.get(
        draft.transitions.find((item) => item.conditionVariable === edgeA.data?.conditionVariable)?.sourceSceneId ?? "",
      ) ?? 0;
      const sourceOrderB = sceneOrderMap.get(
        draft.transitions.find((item) => item.conditionVariable === edgeB.data?.conditionVariable)?.sourceSceneId ?? "",
      ) ?? 0;

      return sourceOrderA - sourceOrderB;
    });

  return {
    characters,
    scenes,
    nodes,
    edges,
  };
}
