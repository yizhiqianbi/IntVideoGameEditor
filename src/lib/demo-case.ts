import type { CharacterDefinition, SceneDefinition } from "../components/editor/project";
import type {
  AgentBranchDraft,
  AgentCharacterDraft,
  AgentDraft,
  AgentScenePresetDraft,
  AgentScreenplay,
  AgentTransitionDraft,
  AgentSceneDraft,
} from "./agent-mode";

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildPortraitIllustration(input: {
  title: string;
  subtitle: string;
  accent: string;
  coat: string;
  hair: string;
  skin: string;
}) {
  return svgDataUrl(`
<svg width="960" height="1200" viewBox="0 0 960 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="1200" rx="44" fill="#121317"/>
  <rect x="34" y="34" width="892" height="1132" rx="34" fill="url(#bg)"/>
  <rect x="88" y="84" width="270" height="28" rx="14" fill="rgba(255,255,255,0.16)"/>
  <rect x="88" y="128" width="360" height="18" rx="9" fill="rgba(255,255,255,0.08)"/>
  <ellipse cx="480" cy="520" rx="230" ry="286" fill="${input.skin}"/>
  <path d="M270 470C292 288 384 206 488 206C620 206 700 300 710 474C642 432 570 412 492 412C418 412 344 432 270 470Z" fill="${input.hair}"/>
  <path d="M304 912C330 760 404 690 480 690C556 690 628 760 654 912V1032H304V912Z" fill="${input.coat}"/>
  <path d="M392 590C414 610 444 622 480 622C516 622 546 610 568 590" stroke="#A26D4B" stroke-width="10" stroke-linecap="round"/>
  <circle cx="410" cy="520" r="16" fill="#2D231F"/>
  <circle cx="550" cy="520" r="16" fill="#2D231F"/>
  <rect x="636" y="88" width="204" height="204" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" stroke-width="3" stroke-dasharray="10 12"/>
  <path d="M700 188L738 150L776 188" stroke="${input.accent}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M738 150V238" stroke="${input.accent}" stroke-width="18" stroke-linecap="round"/>
  <rect x="640" y="330" width="196" height="52" rx="26" fill="${input.accent}"/>
  <text x="738" y="364" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#FFF9F0">默认人物卡</text>
  <text x="88" y="1080" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#FFF9F0">${input.title}</text>
  <text x="88" y="1126" font-family="Arial, sans-serif" font-size="26" fill="rgba(255,249,240,0.72)">${input.subtitle}</text>
  <defs>
    <linearGradient id="bg" x1="108" y1="84" x2="852" y2="1118" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2A2B33"/>
      <stop offset="1" stop-color="#16171C"/>
    </linearGradient>
  </defs>
</svg>
`);
}

function buildSceneIllustration(input: {
  title: string;
  subtitle: string;
  accent: string;
  skyTop: string;
  skyBottom: string;
  land: string;
  detail: string;
}) {
  return svgDataUrl(`
<svg width="1280" height="800" viewBox="0 0 1280 800" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1280" height="800" rx="40" fill="#0D1015"/>
  <rect x="32" y="32" width="1216" height="736" rx="28" fill="url(#sky)"/>
  <circle cx="1040" cy="172" r="82" fill="${input.accent}" fill-opacity="0.86"/>
  <path d="M0 470C140 430 240 410 340 410C470 410 586 446 720 452C838 458 938 422 1068 422C1158 422 1232 442 1280 460V768H0V470Z" fill="${input.land}" fill-opacity="0.95"/>
  <path d="M0 566C118 536 204 520 292 520C432 520 574 590 704 590C822 590 936 528 1080 528C1162 528 1230 540 1280 554V768H0V566Z" fill="${input.detail}" fill-opacity="0.9"/>
  <rect x="92" y="84" width="320" height="30" rx="15" fill="rgba(255,255,255,0.18)"/>
  <rect x="92" y="132" width="468" height="18" rx="9" fill="rgba(255,255,255,0.08)"/>
  <rect x="900" y="526" width="212" height="122" rx="20" fill="rgba(17, 28, 37, 0.76)" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
  <path d="M964 586H1048" stroke="#DDF4FF" stroke-width="16" stroke-linecap="round"/>
  <path d="M1006 544V628" stroke="#DDF4FF" stroke-width="16" stroke-linecap="round"/>
  <text x="92" y="682" font-family="Arial, sans-serif" font-size="50" font-weight="700" fill="#FFF9F0">${input.title}</text>
  <text x="92" y="726" font-family="Arial, sans-serif" font-size="28" fill="rgba(255,249,240,0.76)">${input.subtitle}</text>
  <defs>
    <linearGradient id="sky" x1="640" y1="32" x2="640" y2="768" gradientUnits="userSpaceOnUse">
      <stop stop-color="${input.skyTop}"/>
      <stop offset="1" stop-color="${input.skyBottom}"/>
    </linearGradient>
  </defs>
</svg>
`);
}

export const DEMO_STORY_TEXT = `片名：《雾港回声》

纪录片导演林澈回到即将封港改造的旧雾港，为失踪多年的父亲拍最后一支影像。她意外收到一盘旧录音带，里面记录着父亲在二十年前阻止一次非法沉船交易的证据。随着调查深入，哥哥林舟试图劝她把真相埋进海雾里，摄影记者顾宁则坚持把整座港口的秘密直播出去。林澈必须在亲情、真相和港口居民的命运之间做选择。`;

const DEMO_CHARACTERS: AgentCharacterDraft[] = [
  {
    id: "lin_che",
    name: "林澈",
    bio: "29 岁纪录片导演，冷静敏锐，习惯把情绪藏在镜头后面，真正的动机是确认父亲当年的离开究竟是逃避还是牺牲。",
    appearancePrompt: "东亚年轻女性，黑色长发束起，轮廓干净，穿深灰风衣与旧牛仔裤，写实电影感，眼神克制但锋利。",
    basePrompt: "保持林澈的高马尾、深灰风衣和冷静纪录片导演气质一致，写实镜头，不要夸张妆造。",
    imageModel: "doubao-seedream-5-0-260128",
  },
  {
    id: "lin_zhou",
    name: "林舟",
    bio: "34 岁港口调度员，沉稳寡言，是家里唯一坚持留下的人；他的核心矛盾是保护家人与保护真相之间的拉扯。",
    appearancePrompt: "东亚成年男性，短发，穿旧工装夹克和深色防水靴，海风痕迹明显，真实港口工人质感。",
    basePrompt: "保持林舟的短发、旧工装夹克和被海风磨损的生活质感一致，镜头写实厚重。",
    imageModel: "doubao-seedream-5-0-260128",
  },
  {
    id: "gu_ning",
    name: "顾宁",
    bio: "27 岁摄影记者，外表温和但行动果决，想借这次曝光为港口居民争一个公道，也在试探林澈是否真的愿意面对真相。",
    appearancePrompt: "东亚年轻女性，短发或低马尾，穿浅色衬衫和功能马甲，背相机，眼神坚定，新闻纪实气质。",
    basePrompt: "保持顾宁的新闻记者感、相机道具和干净利落的轮廓一致，写实纪实电影风。",
    imageModel: "doubao-seedream-5-0-260128",
  },
  {
    id: "su_qin",
    name: "苏琴",
    bio: "55 岁港口食堂老板，也是林澈的母亲。她知道最多，却最懂沉默的代价；她的冲突是守住家庭还是守住良心。",
    appearancePrompt: "东亚中年女性，短发，穿深蓝针织衫与围裙，眼神疲惫但坚韧，生活化写实质感。",
    basePrompt: "保持苏琴的短发、中年母亲年龄感和朴素深色衣着一致，写实短剧风格。",
    imageModel: "doubao-seedream-5-0-260128",
  },
];

const DEMO_SCENE_PRESETS: AgentScenePresetDraft[] = [
  {
    id: "fog_harbor",
    name: "雾港码头",
    description: "潮雾笼罩的旧港口，废弃塔吊、低色温灯光和被海水腐蚀的铁轨构成主视觉。",
    appearancePrompt: "清晨雾港码头环境设定图，湿冷海雾，旧塔吊和生锈铁轨，电影感冷蓝灰调，空间纵深明显。",
    basePrompt: "保持雾港码头的塔吊轮廓、冷雾和潮湿地面反光一致，适合作为互动影视核心主场景。",
    imageModel: "doubao-seedream-5-0-260128",
  },
  {
    id: "archive_room",
    name: "潮湿档案室",
    description: "港务楼旧档案室，顶灯频闪，纸箱与船舶登记簿堆满走道，适合悬疑调查戏。",
    appearancePrompt: "老旧档案室环境设定图，窄走道、铁柜、频闪顶灯、纸箱和旧登记簿，悬疑电影感。",
    basePrompt: "保持档案室的拥挤布局、昏黄顶灯和潮湿斑驳墙面一致，适合作为调查戏连续场景。",
    imageModel: "doubao-seedream-5-0-260128",
  },
  {
    id: "tower_platform",
    name: "塔吊平台",
    description: "临海高处的塔吊平台，风大、视野开阔，适合谈判和对峙镜头。",
    appearancePrompt: "海边塔吊高台环境设定图，强风、钢结构栏杆、远处港区灯火，电影感高空对峙氛围。",
    basePrompt: "保持塔吊平台的高空视野、钢结构和海风氛围一致，适合紧张对峙戏。",
    imageModel: "doubao-seedream-5-0-260128",
  },
  {
    id: "lighthouse",
    name: "退潮灯塔",
    description: "退潮后的老灯塔与潮沟，天色将明未明，空间孤独感强，适合情绪戏与真相揭露。",
    appearancePrompt: "海边老灯塔环境设定图，退潮湿地、潮沟反光、将明未明的蓝灰天色，电影感孤独氛围。",
    basePrompt: "保持灯塔、潮沟和低色温黎明光线一致，适合关键真相揭露场景。",
    imageModel: "doubao-seedream-5-0-260128",
  },
];

const DEMO_BRANCHES: AgentBranchDraft[] = [
  {
    id: "family_cover",
    name: "压住真相",
    predictedOutcome: "保住家人表面的平静，但每一步都在接近更大的代价。",
    tone: "压抑",
  },
  {
    id: "public_truth",
    name: "公开真相",
    predictedOutcome: "风险更大，但能逼出真正的幕后结构与失踪真相。",
    tone: "紧张",
  },
];

const DEMO_SCENES: AgentSceneDraft[] = [
  {
    id: "scene_1",
    title: "雾港黎明",
    summary: "林澈拖着摄影箱回到雾港码头，远处封港倒计时牌亮着红光，港口像一座即将沉默的城市。",
    branchId: "family_cover",
    durationSec: 5,
    involvedCharacterIds: ["lin_che"],
    actions: [
      { id: "a1", characterId: "lin_che", action: "拖着摄影箱走进港口", emotion: "克制", dialogue: "这是最后一次了。" },
    ],
    videoPrompt: "远景开场，冷蓝灰雾港码头，女主拖着摄影箱缓慢走入画面，红色封港倒计时牌在远处闪烁，镜头缓推，潮湿地面反光。",
  },
  {
    id: "scene_2",
    title: "旧录音带",
    summary: "苏琴把一盘生锈录音带塞进林澈手里，提醒她有些真相会把人连根拔起。",
    branchId: "family_cover",
    durationSec: 5,
    involvedCharacterIds: ["lin_che", "su_qin"],
    actions: [
      { id: "a2", characterId: "su_qin", action: "把录音带塞到林澈手里", emotion: "压抑", dialogue: "你要拍，就先听这个。" },
      { id: "a3", characterId: "lin_che", action: "盯着母亲的手", emotion: "警觉", dialogue: "" },
    ],
    videoPrompt: "中近景，港口食堂后门，母亲把生锈录音带递给女主，冷色晨光从门缝照进来，手部特写切到女主眼神。",
  },
  {
    id: "scene_3",
    title: "档案室风暴",
    summary: "林澈和顾宁在潮湿档案室找到沉船登记簿，林舟突然出现，要求她立刻停手。",
    branchId: "family_cover",
    durationSec: 6,
    involvedCharacterIds: ["lin_che", "gu_ning", "lin_zhou"],
    actions: [
      { id: "a4", characterId: "gu_ning", action: "翻出登记簿拍照", emotion: "专注", dialogue: "这就是他们删掉的那页。" },
      { id: "a5", characterId: "lin_zhou", action: "推门冲进档案室", emotion: "急迫", dialogue: "别再查了，现在离开。" },
    ],
    videoPrompt: "手持跟拍，老旧档案室窄走道，顶灯轻微频闪，登记簿特写，哥哥突然推门进入，镜头急停形成压迫感。",
  },
  {
    id: "scene_4a",
    title: "塔吊下的交易",
    summary: "林舟带林澈去塔吊平台，提出用一份假船单替掉登记簿，至少能保住母亲和食堂。",
    branchId: "family_cover",
    durationSec: 5,
    involvedCharacterIds: ["lin_che", "lin_zhou"],
    actions: [
      { id: "a6", characterId: "lin_zhou", action: "把假船单压在栏杆上", emotion: "沉重", dialogue: "把它换掉，家还能留住。" },
      { id: "a7", characterId: "lin_che", action: "盯着风里翻动的假船单", emotion: "犹豫", dialogue: "" },
    ],
    videoPrompt: "高处中景，海边塔吊平台强风呼啸，假船单贴着铁栏杆翻动，哥哥和女主对峙，镜头微微环绕增强危险感。",
  },
  {
    id: "scene_5a",
    title: "夜访账册仓",
    summary: "林澈决定暂时合作，夜里独自潜入冷库后的账册仓，发现父亲当年留下了第二份名单。",
    branchId: "family_cover",
    durationSec: 5,
    involvedCharacterIds: ["lin_che"],
    actions: [
      { id: "a8", characterId: "lin_che", action: "用手电扫过成排旧账册", emotion: "紧张", dialogue: "原来你早就想到了。" },
    ],
    videoPrompt: "低照度近景，冷库后方隐蔽仓库，手电光扫过旧账册和水汽，女主从暗格里抽出第二份名单，镜头从肩后推进。",
  },
  {
    id: "scene_6a",
    title: "母亲的底线",
    summary: "苏琴在食堂后厨截住林澈，第一次承认父亲不是逃跑，而是为了让名单离开港口才失踪。",
    branchId: "family_cover",
    durationSec: 6,
    involvedCharacterIds: ["lin_che", "su_qin"],
    actions: [
      { id: "a9", characterId: "su_qin", action: "把煤气火关掉后转身看向林澈", emotion: "崩溃边缘", dialogue: "他不是不要你，他是没法回来。" },
      { id: "a10", characterId: "lin_che", action: "缓慢放下名单", emotion: "震动", dialogue: "" },
    ],
    videoPrompt: "厨房中景转特写，蒸汽与顶灯混合形成压抑氛围，母亲关火转身，表情克制却濒临崩溃，女主手里的名单在画面前景。 ",
  },
  {
    id: "scene_7a1",
    title: "烧掉名单",
    summary: "林澈把第二份名单投入灶火，雾港保住了表面安宁，但父亲真正的名字也一起沉进灰烬。",
    branchId: "family_cover",
    durationSec: 5,
    involvedCharacterIds: ["lin_che", "su_qin"],
    actions: [
      { id: "a11", characterId: "lin_che", action: "把名单送入火里", emotion: "麻木", dialogue: "那就到这里吧。" },
    ],
    videoPrompt: "火光特写转中景，纸张在灶火里卷曲，母女站在厨房昏黄光线里沉默，镜头缓慢后退，留下压抑结尾。",
  },
  {
    id: "scene_7a2",
    title: "当场翻盘",
    summary: "林澈没有烧名单，而是趁封港发布会开始，把它投上大屏，林舟第一次没有拦她。",
    branchId: "family_cover",
    durationSec: 6,
    involvedCharacterIds: ["lin_che", "lin_zhou", "su_qin"],
    actions: [
      { id: "a12", characterId: "lin_che", action: "把名单投上屏幕", emotion: "决绝", dialogue: "今天谁也别替这件事收尾。" },
      { id: "a13", characterId: "lin_zhou", action: "松开拦人的手", emotion: "认命", dialogue: "" },
    ],
    videoPrompt: "发布会现场中景，巨幅屏幕突然亮起名单，红蓝光线交替打在角色脸上，哥哥终于松手，镜头快速推近女主。 ",
  },
  {
    id: "scene_4b",
    title: "灯塔协定",
    summary: "林澈选择相信顾宁，两人带着录音带去退潮灯塔，约定在封港直播前找到最后一名证人。",
    branchId: "public_truth",
    durationSec: 5,
    involvedCharacterIds: ["lin_che", "gu_ning"],
    actions: [
      { id: "a14", characterId: "gu_ning", action: "把相机递给林澈试拍", emotion: "坚定", dialogue: "你要的不是证据，是你敢不敢按下开始。" },
      { id: "a15", characterId: "lin_che", action: "接过相机看向海平线", emotion: "迟疑后坚定", dialogue: "" },
    ],
    videoPrompt: "退潮灯塔远景转双人中景，黎明前的蓝灰海面反光，摄影记者把相机递给女主，风声很大，镜头轻微手持增强纪实感。",
  },
  {
    id: "scene_5b",
    title: "冷库追证",
    summary: "顾宁带林澈闯进冷库走廊，在冷凝水和货柜编号里找到父亲留下的最后一段语音。",
    branchId: "public_truth",
    durationSec: 5,
    involvedCharacterIds: ["lin_che", "gu_ning"],
    actions: [
      { id: "a16", characterId: "gu_ning", action: "撬开货柜夹层", emotion: "紧张", dialogue: "就在这里，别让他们先到。" },
      { id: "a17", characterId: "lin_che", action: "按下语音播放键", emotion: "屏息", dialogue: "" },
    ],
    videoPrompt: "冷库走廊跟拍，白色冷凝雾气、货柜编号和地面积水形成强透视，记者撬开夹层，录音播放器亮起红灯，悬疑感强。",
  },
  {
    id: "scene_6b",
    title: "港口集结",
    summary: "消息提前走漏，居民与工人涌到封港发布会外围，林舟带人拦住顾宁，却没有拿走录音带。",
    branchId: "public_truth",
    durationSec: 6,
    involvedCharacterIds: ["lin_che", "gu_ning", "lin_zhou"],
    actions: [
      { id: "a18", characterId: "lin_zhou", action: "拦在通道口", emotion: "挣扎", dialogue: "你们现在过去，港口就真的保不住了。" },
      { id: "a19", characterId: "gu_ning", action: "举起相机继续直播", emotion: "强硬", dialogue: "那就让所有人看看它是怎么被毁掉的。" },
    ],
    videoPrompt: "发布会外围群像中景，港口工人与居民涌动，哥哥拦住通道，记者开着直播，红色警示灯扫过人群，节奏紧绷。",
  },
  {
    id: "scene_7b1",
    title: "公开名单",
    summary: "林澈在直播里放出录音和名单，整座雾港第一次知道父亲当年不是叛逃，而是在替所有人挡下沉船。",
    branchId: "public_truth",
    durationSec: 6,
    involvedCharacterIds: ["lin_che", "gu_ning", "lin_zhou", "su_qin"],
    actions: [
      { id: "a20", characterId: "lin_che", action: "对着镜头公布录音", emotion: "坚定", dialogue: "今天不是追责，是把被夺走的名字还回来。" },
    ],
    videoPrompt: "直播镜头与现场特写交替，女主面对镜头读出名单，母亲在人群后低头流泪，哥哥站在侧面失神，群体情绪被点燃。",
  },
  {
    id: "scene_7b2",
    title: "父亲现身",
    summary: "就在直播开始前，一艘旧拖轮靠岸，失踪二十年的父亲带着最后一页原始账册出现，雾港的真相终于有了活着的证人。",
    branchId: "public_truth",
    durationSec: 6,
    involvedCharacterIds: ["lin_che", "lin_zhou", "su_qin"],
    actions: [
      { id: "a21", characterId: "lin_che", action: "看着靠岸的旧拖轮愣住", emotion: "难以置信", dialogue: "……爸？" },
      { id: "a22", characterId: "su_qin", action: "从人群里向前一步", emotion: "崩溃", dialogue: "" },
    ],
    videoPrompt: "港口远景转长焦中景，旧拖轮穿过晨雾缓慢靠岸，人物群体回头，母亲与女主同时失神，电影级重逢感与海雾氛围。",
  },
];

const DEMO_TRANSITIONS: AgentTransitionDraft[] = [
  { id: "t1", sourceSceneId: "scene_1", targetSceneId: "scene_2", conditionVariable: "continue_arrive", choiceLabel: "继续" },
  { id: "t2", sourceSceneId: "scene_2", targetSceneId: "scene_3", conditionVariable: "continue_tape", choiceLabel: "继续" },
  { id: "t3", sourceSceneId: "scene_3", targetSceneId: "scene_4a", conditionVariable: "save_family_secret", choiceLabel: "先保住家人" },
  { id: "t4", sourceSceneId: "scene_3", targetSceneId: "scene_4b", conditionVariable: "go_public_with_truth", choiceLabel: "把真相公开" },
  { id: "t5", sourceSceneId: "scene_4a", targetSceneId: "scene_5a", conditionVariable: "continue_cover", choiceLabel: "继续" },
  { id: "t6", sourceSceneId: "scene_5a", targetSceneId: "scene_6a", conditionVariable: "continue_list", choiceLabel: "继续" },
  { id: "t7", sourceSceneId: "scene_6a", targetSceneId: "scene_7a1", conditionVariable: "burn_the_name_list", choiceLabel: "烧掉名单" },
  { id: "t8", sourceSceneId: "scene_6a", targetSceneId: "scene_7a2", conditionVariable: "reveal_on_stage", choiceLabel: "当场翻盘" },
  { id: "t9", sourceSceneId: "scene_4b", targetSceneId: "scene_5b", conditionVariable: "continue_lighthouse", choiceLabel: "继续" },
  { id: "t10", sourceSceneId: "scene_5b", targetSceneId: "scene_6b", conditionVariable: "continue_evidence", choiceLabel: "继续" },
  { id: "t11", sourceSceneId: "scene_6b", targetSceneId: "scene_7b1", conditionVariable: "broadcast_everything", choiceLabel: "立即公开" },
  { id: "t12", sourceSceneId: "scene_6b", targetSceneId: "scene_7b2", conditionVariable: "wait_for_last_witness", choiceLabel: "再等一刻" },
];

export const DEMO_AGENT_DRAFT: AgentDraft = {
  id: "demo_case_fog_harbor",
  storyTitle: "雾港回声",
  sourceText: DEMO_STORY_TEXT,
  feedback: "",
  summary: "一位纪录片导演回到封港前夜的旧雾港，在亲情与真相之间做出决定；所有选择都会改变父亲失踪案的最终意义。",
  characters: DEMO_CHARACTERS,
  scenePresets: DEMO_SCENE_PRESETS,
  scenes: DEMO_SCENES,
  transitions: DEMO_TRANSITIONS,
  branches: DEMO_BRANCHES,
};

export const DEMO_AGENT_SCREENPLAY: AgentScreenplay = {
  title: "雾港回声",
  logline: "封港前夜，纪录片导演林澈带着摄影机回到旧港，在亲情与真相之间做出决定。",
  script: `【场景1：雾港黎明】
远景。潮雾低垂，塔吊像被废弃的骨架。林澈拖着摄影箱穿过反光的码头地面。
林澈（低声）："这是最后一次了。"
切至 → 旧录音带

【场景2：旧录音带】
中近景。食堂后门。苏琴把一盘生锈录音带塞进林澈手里。
苏琴："你要拍，就先听这个。"
林澈盯着母亲粗糙的手，没有追问。
切至 → 档案室风暴

【场景3：档案室风暴 | 选择点1】
手持跟拍。林澈与顾宁在档案室翻出沉船登记簿。林舟推门闯入。
顾宁："这就是他们删掉的那页。"
林舟："别再查了，现在离开。"
选择 A：先保住家人
选择 B：把真相公开

【分支A：先保住家人】
【场景4A：塔吊下的交易】
高处中景。林舟把假船单压在栏杆上，海风几乎把纸卷走。
林舟："把它换掉，家还能留住。"

【场景5A：夜访账册仓】
冷库后仓。林澈找到父亲留下的第二份名单。
林澈（低声）："原来你早就想到了。"

【场景6A：母亲的底线 | 选择点2】
后厨蒸汽弥漫。苏琴第一次承认父亲不是逃跑，而是为了让名单离开港口才失踪。
苏琴："他不是不要你，他是没法回来。"
选择 A1：烧掉名单
选择 A2：当场翻盘

【结局A1：烧掉名单】
火光吞掉纸张。母女沉默。港口保住了表面的平静，但名字也一并被埋进灰烬。

【结局A2：当场翻盘】
发布会现场。名单突然投上大屏。林舟终于没有再拦林澈。
林澈："今天谁也别替这件事收尾。"

【分支B：把真相公开】
【场景4B：灯塔协定】
退潮灯塔。顾宁把相机递给林澈。
顾宁："你要的不是证据，是你敢不敢按下开始。"

【场景5B：冷库追证】
冷凝雾气里，两人找到父亲留下的最后一段语音。
顾宁："就在这里，别让他们先到。"

【场景6B：港口集结 | 选择点2】
发布会外围，人群涌动。林舟拦在通道口。
林舟："你们现在过去，港口就真的保不住了。"
选择 B1：立即公开
选择 B2：再等一刻

【结局B1：公开名单】
林澈面对镜头读出名单，整座港口第一次知道父亲当年不是叛逃，而是在替所有人挡下沉船。

【结局B2：父亲现身】
旧拖轮穿过晨雾靠岸。失踪二十年的父亲带着最后一页原始账册走下船。所有人都愣在原地。`,
};

export function applyDemoVisuals(input: {
  characters: CharacterDefinition[];
  scenes: SceneDefinition[];
}) {
  const characterIllustrations: Record<string, string> = {
    lin_che: buildPortraitIllustration({
      title: "林澈",
      subtitle: "纪录片导演 / 冷静调查者",
      accent: "#E86C4A",
      coat: "#3A4B5F",
      hair: "#17181D",
      skin: "#D4A988",
    }),
    lin_zhou: buildPortraitIllustration({
      title: "林舟",
      subtitle: "港口调度员 / 守口如瓶",
      accent: "#4AA3C9",
      coat: "#4A5A46",
      hair: "#17181D",
      skin: "#C89D7A",
    }),
    gu_ning: buildPortraitIllustration({
      title: "顾宁",
      subtitle: "摄影记者 / 坚定见证者",
      accent: "#F09A4A",
      coat: "#7E877B",
      hair: "#15161B",
      skin: "#D8B195",
    }),
    su_qin: buildPortraitIllustration({
      title: "苏琴",
      subtitle: "食堂老板 / 知情母亲",
      accent: "#D46B8D",
      coat: "#415A64",
      hair: "#202026",
      skin: "#C99E82",
    }),
  };
  const sceneIllustrations: Record<string, string> = {
    fog_harbor: buildSceneIllustration({
      title: "雾港码头",
      subtitle: "海雾、旧塔吊、封港前夜",
      accent: "#FFB866",
      skyTop: "#20364E",
      skyBottom: "#0E1622",
      land: "#314D66",
      detail: "#203647",
    }),
    archive_room: buildSceneIllustration({
      title: "潮湿档案室",
      subtitle: "频闪顶灯、铁柜、旧船簿",
      accent: "#EACD72",
      skyTop: "#5E533F",
      skyBottom: "#23231F",
      land: "#3C3E43",
      detail: "#262830",
    }),
    tower_platform: buildSceneIllustration({
      title: "塔吊平台",
      subtitle: "临海高处、强风、对峙空间",
      accent: "#F1855C",
      skyTop: "#324558",
      skyBottom: "#16202C",
      land: "#425567",
      detail: "#273947",
    }),
    lighthouse: buildSceneIllustration({
      title: "退潮灯塔",
      subtitle: "潮沟反光、黎明蓝灰、真相时刻",
      accent: "#F7D17C",
      skyTop: "#455D7A",
      skyBottom: "#172235",
      land: "#3C5363",
      detail: "#253A45",
    }),
  };

  return {
    characters: input.characters.map((character) => ({
      ...character,
      placeholderUrl: characterIllustrations[character.id],
    })),
    scenes: input.scenes.map((scene) => ({
      ...scene,
      placeholderUrl: sceneIllustrations[scene.id],
    })),
  };
}
