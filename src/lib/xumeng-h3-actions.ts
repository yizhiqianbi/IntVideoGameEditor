import type { GenerationTemplate } from "./xumeng-generation-templates";

const repo = "EllaPriest45/MinimaxH3_Actions" as const;

type H3ActionSource = {
  id: string;
  label: string;
  englishLabel: string;
  description: string;
  tags: readonly string[];
  action: string;
  trigger: string;
  strength: string;
  weightFile: string;
  group: string;
};

const VIDEO_GROUP_LABELS: Record<string, string> = {
  "sixty-nine": "六九", foot: "足交", tit: "乳交", hand: "手交", thigh: "腿交", oral: "口交", anal: "肛交",
  cowgirl: "女上位", doggy: "后入", missionary: "传教士", finger: "指交", toy: "玩具", cum: "射精",
  bound: "捆绑", face: "表情", kiss: "接吻", group: "多人", futa: "双性", chest: "胸部", rear: "臀部",
  groin: "阴部", nude: "裸体", penis: "阴茎", lingerie: "内衣", figure: "身材", sex: "性交", other: "其他",
};
const groupLabel = (id: string) => VIDEO_GROUP_LABELS[id] ?? "其他";

/** H3 reference-to-video prompt. Image 1 is the person; Video 1 is the action template. */
export function buildH3ActionPrompt(action: string, note = ""): string {
  const extra = note.trim();
  return [
    "规格：5秒 | 24fps | 写实连续单镜头 | 9:16。同一空间、连续时间、一条运镜；无内部切镜、无跳切、无蒙太奇、无黑场。",
    "主体：Image 1 中的成年人物是唯一要保留身份的人。脸、发型、肤色、五官和年龄外观从第一帧到最后一帧都来自 Image 1。Video 1 提供姿势、服装、房间、光线和动作。",
    "时间轴：",
    "0–2秒：先站住。姿势、服装、房间和机位沿用 Video 1 的开头。脸上已经是 Image 1 的人。",
    `动作：${action}一个连贯镜头。`,
    "中间：接触、方向和重量跟随 Video 1。脸和发型始终是 Image 1。",
    "末1–2秒：停在 Video 1 结束时的静止姿势，不再开新动作。脸、发型和身份仍是 Image 1。",
    "镜头：跟随 Video 1，一个景别加一种连续运镜，不切镜。",
    "场景：沿用 Video 1 的房间、服装和光线。",
    "声音：只保留现场的身体与环境声，无旁白，无突然出现的背景音乐。",
    "风格：写实真人，自愿的成年人，21岁以上。",
    "光线：沿用 Video 1。",
    "连续性：把 Image 1 的人放进 Video 1，替换模板里原来的人。Image 1 不是第一帧照片；第一帧已经是 Video 1 的姿势，脸从第一帧起就是 Image 1。Video 1 原来的脸、发型和身份不要留下来。画面里若还有另一个身体，那个身体只保留 Video 1 的姿势和接触，不把 Video 1 的脸安到主体上。",
    extra ? `补充：${extra}。` : "",
    "无字幕、无水印、无面部漂移、无身份更换、无多余手指、无手指粘连、无穿模、无油腻皮肤、无畸形生殖器、无未成年人、无幼态面孔、无校服。",
  ].filter(Boolean).join("\n");
}

const h3Pattern = (action: string) => buildH3ActionPrompt(action);

const sources: readonly H3ActionSource[] = [
  { id: "h3-blowjob", label: "口交", englishLabel: "Blowjob", description: "让参考图中的成年人物口交", tags: ["参考图", "亲密", "口交", "blowjob"], group: "oral", strength: "1", trigger: "blowjob, sucking penis", weightFile: "Blowjob (NSFW) - MinimaxH3 - blowjob,sucking penis.safetensors", action: "她含住勃起的阴茎，嘴唇贴着柱身来回吮吸。" },
  { id: "h3-deepthroat", label: "口交", englishLabel: "Deep Hold", description: "成年人物把阴茎含深并停住", tags: ["参考图", "亲密", "深喉", "oral"], group: "oral", strength: "0.8", trigger: "oralmove1, oraldetail1", weightFile: "Deeper... Hold It. - MinimaxH3 - oralmove1,oraldetail1,0.8str.safetensors", action: "她把阴茎缓慢含到口腔深处，停住，再控制着退出。" },
  { id: "h3-handjob", label: "手交", englishLabel: "Handjob", description: "成年人物用手套弄阴茎", tags: ["参考图", "亲密", "手交", "handjob"], group: "hand", strength: "1", trigger: "handjob", weightFile: "Handjob - MinimaxH3.safetensors", action: "她用手握住阴茎，沿柱身上下套弄。" },
  { id: "h3-titfuck", label: "乳交", englishLabel: "Titfuck", description: "成年人物用胸部夹住并抽动", tags: ["参考图", "亲密", "乳交", "titfuck"], group: "tit", strength: "1", trigger: "titjob, titfuck", weightFile: "Better Titfuck v0.95 - MinimaxH3 - res_multistep+simple,titjob,titfuck.safetensors", action: "她用双手把乳房挤在一起，夹住阴茎上下抽动。" },
  { id: "h3-cowgirl", label: "女上位", englishLabel: "Cowgirl", description: "成年人物以女上位骑乘", tags: ["参考图", "亲密", "女上位", "cowgirl"], group: "cowgirl", strength: "1", trigger: "cowgirl position", weightFile: "Cowgirl Position (NSFW) REF2V R512 - MinimaxH3 - cowgirl position.safetensors", action: "她跨坐在对方身上，以女上位上下骑乘，阴茎在阴道内抽插。" },
  { id: "h3-doggy", label: "后入", englishLabel: "Doggy Style", description: "成年人物以后入体位交合", tags: ["参考图", "亲密", "后入", "doggy"], group: "doggy", strength: "1", trigger: "POV doggystyle sex", weightFile: "POV Doggy - MinimaxH3 - POV doggystyle sex.safetensors", action: "从对方视角看她趴好，阴茎插入阴道并前后抽送。" },
  { id: "h3-missionary", label: "传教士", englishLabel: "Missionary", description: "成年人物以传教士体位交合", tags: ["参考图", "亲密", "传教士", "missionary"], group: "missionary", strength: "1", trigger: "having missionary sex", weightFile: "Missionary Sex - POV - MinimaxH3 - having missionary sex.safetensors", action: "她仰卧，对方以传教士体位把阴茎插入阴道并抽送。" },
  { id: "h3-spooning", label: "性交", englishLabel: "Spooning", description: "两名成年人侧卧交合", tags: ["参考图", "亲密", "侧卧", "spooning"], group: "sex", strength: "1", trigger: "SPOONLG", weightFile: "Spooning Sex Position FL2VA - MinimaxH3 - SPOONLG.,add hmpenis 0.6str,motion booster 0.3-0.4str,10+seconds.safetensors", action: "两名成年人侧卧贴在一起，阴茎从后方插入阴道抽送。" },
  { id: "h3-fingering", label: "指交", englishLabel: "Fingering", description: "成年人物用手指插入阴道", tags: ["参考图", "亲密", "指交", "fingering"], group: "finger", strength: "1", trigger: "sensual_fingering, fingering her vagina with her two middle fingers, her fingers are sliding in and out of her vagina", weightFile: "Perfect Fingering - MinimaxH3 - sensual_fingering,fingering her vagina with her two middle fingers, her fingers are sliding in and out of her vagina.safetensors", action: "她用两根手指插入自己的阴道，手指在里面来回抽送。" },
  { id: "h3-dildo", label: "玩具", englishLabel: "Dildo", description: "成年人物用假阳具抽插", tags: ["参考图", "亲密", "假阳具", "dildo"], group: "toy", strength: "1", trigger: "pumping a dildo insider her vagina", weightFile: "Dildoing - MinimaxH3 - pumping a dildo insider her vagina.safetensors", action: "她把假阳具插入阴道，握住它抽送。" },
  { id: "h3-masturbation", label: "性交", englishLabel: "Panty Masturbation", description: "成年人物把手伸进内裤抚摸", tags: ["参考图", "亲密", "自慰", "panties"], group: "sex", strength: "0.7", trigger: "She has her hand in her panties, She slides her hand in her panties. She rubs her vagina", weightFile: "Hand in Panties Masturbation  - MinimaxH3 - 0.7str,She has her hand in her panties,She slides her hand in her panties.She rubs her vagina.safetensors", action: "她把手伸进内裤，抚摸并揉搓自己的阴道。" },
  { id: "h3-footjob", label: "足交", englishLabel: "Footjob", description: "成年人物用脚摩擦阴茎", tags: ["参考图", "亲密", "足交", "footjob"], group: "foot", strength: "1", trigger: "h3fj, the woman is performing a footjob", weightFile: "H3 Footjob v0 - MinimaxH3 - a photoealistic video depicting a woman sitting in front of the viewer.the camera angle is a male pov.the viewer's penis is exposed.the woman is performing a footjob.h3fj.safetensors", action: "她坐在对方面前，用脚夹住并摩擦对方的阴茎。" },
  { id: "h3-ahegao", label: "表情", englishLabel: "Ahegao", description: "成年人物做出翻白眼伸舌的表情", tags: ["参考图", "亲密", "表情", "ahegao"], group: "face", strength: "1", trigger: "She is making the ahegao face - eyes rolled back and tongue hanging out", weightFile: "Ahegao Face - MinimaxH3 - She is making the ahegao face - eyes rolled back and tongue hanging out.safetensors", action: "她翻起眼睛，张开嘴，舌头伸出。" },
  { id: "h3-breast-bounce", label: "胸部", englishLabel: "Breast Bounce", description: "成年人物的胸部上下左右晃动", tags: ["参考图", "亲密", "胸部", "bounce"], group: "chest", strength: "1", trigger: "her breast is bouncing up and down, her breast is bouncing from left to right", weightFile: "Bouncing Boobs REF2V v0.7 - MinimaxH3 - her breast is bouncing up and down,her breast is bouncing from left to right.safetensors", action: "她的乳房上下、左右晃动。" },
  { id: "h3-twerk", label: "臀部", englishLabel: "Twerk", description: "成年人物扭臀并让臀部晃动", tags: ["参考图", "亲密", "扭臀", "twerk"], group: "rear", strength: "0.8", trigger: "twerks causing her ass to jiggle and shake", weightFile: "Slop Twerk v0.2 Epoch6 - MinimaxH3 - twerks causing her ass to jiggle and shake,0.5-1str,0.5 STR if you don't want Asians in T2V.safetensors", action: "她扭动臀部，臀肉随之抖动。" },
  { id: "h3-cumshot", label: "射精", englishLabel: "Cumshot", description: "画面呈现一次射精", tags: ["参考图", "亲密", "射精", "cumshot"], group: "cum", strength: "1", trigger: "CUMSH0T", weightFile: "Epic Cumshots vAlpha I2V-R2V - MinimaxH3 - CUMSH0T.safetensors", action: "阴茎射出精液，精液落在成年人物身上。" },
  { id: "h3-facial", label: "射精", englishLabel: "Facial", description: "精液射在成年人物脸上", tags: ["参考图", "亲密", "颜射", "facial"], group: "cum", strength: "0.8", trigger: "cmst", weightFile: "Facial CumShot REF2VA - MinimaxH3 - cmst,0.75-0.85str.safetensors", action: "她仰头看向镜头，精液射在她脸上。" },
  { id: "h3-spank", label: "臀部", englishLabel: "Spank", description: "拍打成年人物的臀部", tags: ["参考图", "亲密", "拍臀", "spank"], group: "rear", strength: "1", trigger: "spa_nk", weightFile: "SpankMe - MiniMaxH3 - spa_nk.safetensors", action: "手掌拍在她裸露的臀部上。" },
  { id: "h3-bound", label: "捆绑", englishLabel: "Tied Pose", description: "成年人物处于自愿捆绑姿态", tags: ["参考图", "亲密", "捆绑", "tied"], group: "bound", strength: "0.8", trigger: "tied pose, her wrists and ankles are tied", weightFile: "All Tied Up - MinimaxH3 - 0.8str.safetensors", action: "她保持自愿的捆绑姿态，手腕和脚踝被缚住，身体只做小幅动作。" },
  { id: "h3-bikini", label: "内衣", englishLabel: "Micro Bikini", description: "成年人物穿着微型比基尼", tags: ["参考图", "亲密", "比基尼", "bikini"], group: "lingerie", strength: "0.9", trigger: "bikini", weightFile: "Micro Bikini v5.0 - MinimaxH3 - bikini,0.9str.safetensors", action: "她穿着微型比基尼，缓慢扭动胯部并转身。" },
  { id: "h3-blowjob-v3", label: "口交", englishLabel: "Blowjob v3", description: "成年人物口交", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "bl0w_j0b", weightFile: "Blowjob v3.0 - MinimaxH3 - bl0w_j0b.safetensors", action: "她含住阴茎，头部小幅前后移动。" },
  { id: "h3-blowjob-thong", label: "口交", englishLabel: "Blowjob in Thong", description: "穿着丁字裤的成年人物口交", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "blowjob_wearing_thong", weightFile: "Blowjob wearing Thong - MinimaxH3 - blowjob_wearing_thong.safetensors", action: "她穿着丁字裤，含住阴茎吮吸。" },
  { id: "h3-softsuck", label: "口交", englishLabel: "Soft Suction", description: "成年人物轻柔吮吸", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "0.7", trigger: "soft,rhythmic suction", weightFile: "Softsuck Blowjob - MinimaxH3 - She takes the glans into her mouth and begins soft,rhythmic suction,her head moving in small controlled forward-and-back motions,0.7-0.8str.safetensors", action: "她含住龟头，轻轻前后吮吸。" },
  { id: "h3-closeup-blowjob", label: "口交", englishLabel: "Close-up Oral", description: "俯拍成年人物口交", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "0.8", trigger: "camera zooms in on the penis in her mouth", weightFile: "Extreme Close-up Blowjob Top Down POV - MinimaxH3 - 0.8str,female giving a handjob to a man, the camera zooms in on the penis in her mouth.safetensors", action: "镜头从上方靠近，她含着阴茎。" },
  { id: "h3-messy-blowjob", label: "口交", englishLabel: "Messy Oral", description: "成年人物口交时口中带出液体", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "ME$$Y", weightFile: "Messy Blowjob - MinimaxH3 - ME$$Y,have penis in startup image or penis reference.safetensors", action: "她含住阴茎吮吸，口角带出透明液体。" },
  { id: "h3-oral-creampie", label: "口交", englishLabel: "Oral Creampie", description: "成年人物把精液含在口中", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "0.4", trigger: "CUMOUF", weightFile: "CIMLG - The Oral Creampie v2.0 - MinimaxH3 - CUMOUF,0.4str,use eros max beta6,10seconds videos.safetensors", action: "她含着阴茎，精液留在口中。" },
  { id: "h3-cum-swallow", label: "口交", englishLabel: "Swallow", description: "成年人物吞下口中的精液", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "0.4", trigger: "TADAA", weightFile: "Cum Swallow - MinimaxH3 - TADAA,0.4str.safetensors", action: "她咽下口中的精液。" },
  { id: "h3-cunnilingus", label: "口交", englishLabel: "Cunnilingus", description: "成年人物为另一名成年人舔阴", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "She performs cunnilingus on her", weightFile: "Cunnilingus v2.0 - MinimaxH3 - She performs cunnilingus on her.She licks her pussy.safetensors", action: "她低头舔弄另一名成年人的阴部。" },
  { id: "h3-lesbian-oral", label: "口交", englishLabel: "Two Women Oral", description: "两名成年女性互相口交", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "lesbian cunnilingus", weightFile: "Lesbian Cunnilingus v3.0 - MinimaxH3.safetensors", action: "两名成年女性互相舔弄阴部。" },
  { id: "h3-auto-oral", label: "口交", englishLabel: "Self Oral", description: "成年人物自己舔阴", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "She performs oral sex on herself", weightFile: "Auto-Cunnilingus - MinimaxH3 - She performs oral sex on herself.She licks her vulva.safetensors", action: "她弯下身体，舔自己的阴部。" },
  { id: "h3-lick-penis", label: "口交", englishLabel: "Licking", description: "成年人物舔阴茎和睾丸", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "licking penis,licking testicles", weightFile: "Licking Penis and Testicles (NSFW) v1.2 - MinimaxH3 - licking penis,licking testicles,licking penis tip,Only works if penis and testicles are in view.safetensors", action: "她用舌头舔阴茎和睾丸。" },
  { id: "h3-deepthroat-side", label: "口交", englishLabel: "Side Deep Oral", description: "侧面看成年人物含深", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "can do 15 seconds", weightFile: "Daring's Deepthroat FL2VA v0.2 - MinimaxH3 - can do 15 seconds.safetensors", action: "从侧面看，她把阴茎含到深处再退出。" },
  { id: "h3-throat", label: "口交", englishLabel: "Throat", description: "成年人物把阴茎含到喉咙", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "thr0at", weightFile: "Throat Time v2.0 - MinimaxH3 - thr0at,6-8steps for turbo,20steps for normal.safetensors", action: "她把阴茎含到喉咙附近，再缓慢退出。" },
  { id: "h3-sixtynine", label: "六九", englishLabel: "Sixty-nine", description: "两名成年人六九式互相口交", tags: ["参考图", "亲密", "六九"], group: "sixty-nine", strength: "1", trigger: "frenulum 69", weightFile: "Ultimate DeepThroat + Frenulum 69 v1.1 - MinimaxH3.safetensors", action: "两名成年人头脚相对，互相口交。" },
  { id: "h3-handjob-duo", label: "手交", englishLabel: "Two-handed Stroke", description: "两名成年人用手套弄", tags: ["参考图", "亲密", "手交"], group: "hand", strength: "1", trigger: "2-Handed Twisting Handjob", weightFile: "2 Girls 2-Handed Twisting Handjob Frontal - MinimaxH3 - 1str.safetensors", action: "两名成年人从正面用手握住阴茎扭转套弄。" },
  { id: "h3-jerk", label: "手交", englishLabel: "Stroking", description: "成年人物用手上下套弄", tags: ["参考图", "亲密", "手交"], group: "hand", strength: "1", trigger: "jerking off", weightFile: "Jerking Off - MinimaxH3 - he-she is jerking off.safetensors", action: "她用手握住阴茎上下套弄。" },
  { id: "h3-paizuri", label: "乳交", englishLabel: "Paizuri", description: "成年人物挤胸夹住并抽动", tags: ["参考图", "亲密", "乳交"], group: "tit", strength: "1", trigger: "she gathers her breasts around the penis", weightFile: "Paizuri - Titfuck (With Thrusting + Squeeze) FL2VA - MinimaxH3 - she gathers her breasts around the penis.safetensors", action: "她把乳房挤在阴茎两侧，上下挤压抽动。" },
  { id: "h3-titfuck-side", label: "乳交", englishLabel: "Side Titfuck", description: "侧面乳交", tags: ["参考图", "亲密", "乳交"], group: "tit", strength: "1", trigger: "titfuck_sideview", weightFile: "Titfuck Sideview I2V on FL2VA - MinimaxH3 - titfuck_sideview,cut,transition,add penis lora low str.safetensors", action: "从侧面看，她用胸部夹住阴茎抽动。" },
  { id: "h3-nipple-play", label: "胸部", englishLabel: "Nipple Play", description: "成年人物拨弄乳头", tags: ["参考图", "亲密", "胸部"], group: "chest", strength: "1", trigger: "fingertip teasing,flicking on the nipple", weightFile: "Nipple Play v2.0 - MinimaxH3 - fingertip teasing,flicking on the nipple,sucking nipples.safetensors", action: "手指拨弄并轻弹她的乳头。" },
  { id: "h3-nipple-suck", label: "胸部", englishLabel: "Nipple Sucking", description: "吮吸成年人物的乳头", tags: ["参考图", "亲密", "胸部"], group: "chest", strength: "1", trigger: "sucks her nipple", weightFile: "Nipple Sucking - MinimaxH3 - He-she sucks her nipple.safetensors", action: "嘴含住她的乳头吮吸。" },
  { id: "h3-cowgirl-behind", label: "女上位", englishLabel: "Rear Cowgirl", description: "从后方看女上位", tags: ["参考图", "亲密", "女上位"], group: "cowgirl", strength: "1", trigger: "rear view cowgirl sex", weightFile: "Cowgirl - Behind - MinimaxH3 - rear view cowgirl sex,riding a man, straddling him.safetensors", action: "从后方看她跨坐骑乘，上下起伏。" },
  { id: "h3-cowgirl-side", label: "女上位", englishLabel: "Side Cowgirl", description: "侧面女上位", tags: ["参考图", "亲密", "女上位"], group: "cowgirl", strength: "1", trigger: "side view cowgirl sex", weightFile: "Side Riding Cowgirl v2.0 - MiniMaxH3 - riding a man,straddling his hips,side view cowgirl sex,facing the man.safetensors", action: "从侧面看她面向对方跨坐骑乘。" },
  { id: "h3-riding-pov", label: "女上位", englishLabel: "Riding POV", description: "主观视角看骑乘", tags: ["参考图", "亲密", "女上位"], group: "cowgirl", strength: "0.6", trigger: "front-back view", weightFile: "Riding pov I2V - MinimaxH3 - front-back view,female,futa,0.6-1str.safetensors", action: "从对方视角看她骑在身上上下移动。" },
  { id: "h3-doggy-leg", label: "后入", englishLabel: "Leg-up Doggy", description: "抬腿后入", tags: ["参考图", "亲密", "后入"], group: "doggy", strength: "1", trigger: "doggystyle leg up sex", weightFile: "Doggy Style - Leg Up - MinimaxH3 - doggystyle leg up sex.safetensors", action: "她抬起一条腿，从后方插入抽送。" },
  { id: "h3-doggy-side", label: "后入", englishLabel: "Side Doggy", description: "侧后方后入", tags: ["参考图", "亲密", "后入"], group: "doggy", strength: "0.8", trigger: "side-rear", weightFile: "Doggystyle Sex Side-Rear View - MinimaxH3 - 0.5-0.7 t2va-ref2va,0.8-1str fl2va.safetensors", action: "从侧后方看她趴着，阴茎从后面抽送。" },
  { id: "h3-prone", label: "后入", englishLabel: "Prone", description: "俯卧后入", tags: ["参考图", "亲密", "后入"], group: "doggy", strength: "1", trigger: "prone bone", weightFile: "Prone Bone - MinimaxH3.safetensors", action: "她俯卧，对方从上方插入抽送。" },
  { id: "h3-lotus", label: "性交", englishLabel: "Lotus", description: "莲花坐位交合", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "1", trigger: "lotus position", weightFile: "Lotus Sex Position - MinimaxH3 - They are having sex in the lotus position.safetensors", action: "两名成年人面对面坐着交合，她的腿盘在对方腰侧。" },
  { id: "h3-side-fuck", label: "性交", englishLabel: "Side Sex", description: "侧身交合", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "0.75", trigger: "0.75-0.85str", weightFile: "Side Fuck R2V - MinimaxH3 - 0.75-0.85str.safetensors", action: "两名成年人侧身贴在一起抽送。" },
  { id: "h3-grind", label: "性交", englishLabel: "Grinding", description: "交合时扭胯", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "1", trigger: "grindtime", weightFile: "Grindtime - MinimaxH3 - grindtime,a woman performing continuous rhythmic gyrating hip motion while having sex,front-rear-side view.safetensors", action: "交合时她的胯部持续画圈扭动。" },
  { id: "h3-pillow", label: "性交", englishLabel: "Pillow Humping", description: "成年人物骑在枕头上磨蹭", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "1", trigger: "humping the pillow", weightFile: "Pillow Humping v3.1 (hip thrusting, humping, grinding enhancer) - MinimaxH3 - She is straddling a pillow. She is humping the pillow.safetensors", action: "她跨坐在枕头上，胯部前后磨蹭。" },
  { id: "h3-facesit", label: "口交", englishLabel: "Facesitting", description: "成年人物坐到对方面上", tags: ["参考图", "亲密", "口交"], group: "oral", strength: "1", trigger: "facesitting on the viewer", weightFile: "Sit on my face - MinimaxH3REF2V - facesitting on the viewer,looking upward,above the viewer,She is thrusting her hips back and forth,The camera is placed between her legs,very wide angle with a fisheye.safetensors", action: "她跨坐在对方面前，胯部前后移动。" },
  { id: "h3-scissor", label: "性交", englishLabel: "Scissoring", description: "两名成年人剪刀式磨蹭", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "1", trigger: "They are scissoring", weightFile: "Scissoring - Tribbing v2.0 - MinimaxH3 - They are scissoring,Their legs are intertwined,can use pillow humping lora at low str.safetensors", action: "两名成年人腿交叠，阴部互相磨蹭。" },
  { id: "h3-fingering-v4", label: "指交", englishLabel: "Two-finger Insertion", description: "两指插入阴道抽送", tags: ["参考图", "亲密", "指交"], group: "finger", strength: "1", trigger: "slides two fingers into her vagina", weightFile: "Fingering v4.0 - MinimaxH3 - She slides two fingers into her vagina. She moves her fingers in and out of her vagina.safetensors", action: "她把两根手指插入阴道，来回抽送。" },
  { id: "h3-anal-finger", label: "肛交", englishLabel: "Anal Fingering", description: "手指插入肛门", tags: ["参考图", "亲密", "肛交"], group: "anal", strength: "1", trigger: "anal finger", weightFile: "Self Anal Finger - MinimaxH3.safetensors", action: "她把手指插入自己的肛门抽送。" },
  { id: "h3-rimjob", label: "肛交", englishLabel: "Rimming", description: "舔弄成年人物的肛门", tags: ["参考图", "亲密", "肛交"], group: "anal", strength: "0.75", trigger: "rjvideo", weightFile: "Rimjob_ass licking_anal - MinimaxH3 - rjvideo,POV,side view,side-rear view,lying on the back,0.75-1str.safetensors", action: "舌头舔弄她的肛门。" },
  { id: "h3-dildo-ride", label: "玩具", englishLabel: "Dildo Ride", description: "成年人物骑在假阳具上", tags: ["参考图", "亲密", "玩具"], group: "toy", strength: "1", trigger: "rides a dildo", weightFile: "Dildo Ride - MinimaxH3 - She rides a dildo, moving her body up and down as the dildo slides in and out of her vagina.viewed from the front,viewed from behind,viewed from a high angle,viewed from a low angle.safetensors", action: "她骑在假阳具上，身体上下移动。" },
  { id: "h3-dildo-solo", label: "玩具", englishLabel: "Dildo In and Out", description: "假阳具在阴道中抽送", tags: ["参考图", "亲密", "玩具"], group: "toy", strength: "1", trigger: "slide a dildo", weightFile: "Dildo Masturbation v2.0 - MinimaxH3 - She slide a dildo in and out of her pussy.safetensors", action: "她把假阳具插入阴道来回抽送。" },
  { id: "h3-wand", label: "玩具", englishLabel: "Wand", description: "按摩棒抵在阴部", tags: ["参考图", "亲密", "玩具"], group: "toy", strength: "1", trigger: "Hitachi Magic Wand", weightFile: "Hitachi Magic Wand Vibrator - MinimaxH3 - using a Hitachi Magic Wand vibrator.safetensors", action: "她把按摩棒抵在阴部上。" },
  { id: "h3-sybian", label: "玩具", englishLabel: "Sybian", description: "骑在震动座上", tags: ["参考图", "亲密", "玩具"], group: "toy", strength: "1", trigger: "riding a Sybian", weightFile: "Simply Sybian - Bouncing Edition - MinimaxH3 - riding a Sybian.safetensors", action: "她骑在震动座上，身体随着震动起伏。" },
  { id: "h3-squirt", label: "玩具", englishLabel: "Vibrator and Squirt", description: "震动后喷出液体", tags: ["参考图", "亲密", "玩具"], group: "toy", strength: "0.7", trigger: "0.7-0.8str", weightFile: "Vibrator & Squirting - MinimaxH3 - 0.7-0.8str,720x1280,15-30steps.safetensors", action: "震动棒抵在阴部，随后喷出透明液体。" },
  { id: "h3-strapon", label: "玩具", englishLabel: "Strap-on", description: "穿着穿戴式假阳具", tags: ["参考图", "亲密", "玩具"], group: "toy", strength: "1", trigger: "strapon dildo", weightFile: "Strapon Dildo v0.1 - MinimaxH3 - She is wearing a strapon dildo.safetensors", action: "她系着穿戴式假阳具，胯部向前顶。" },
  { id: "h3-cum-shots", label: "射精", englishLabel: "Cum on Body", description: "精液落在身上", tags: ["参考图", "亲密", "射精"], group: "cum", strength: "1", trigger: "He ejaculates", weightFile: "Cum Shots - MinimaxH3 - He ejaculates,Spurts of semen land on her BODY PART.safetensors", action: "精液喷射并落在成年人物身上。" },
  { id: "h3-ahegao-v3", label: "表情", englishLabel: "Ahegao v3", description: "翻白眼伸舌并流出口水", tags: ["参考图", "亲密", "表情"], group: "face", strength: "1", trigger: "making the ahegao face", weightFile: "Ahegao Face v3.0 - MinimaxH3 - he crosses her eyes,opens her mouth,and sticks out her tongue,making the ahegao face.A single drop of clear saliva drips from her tongue.safetensors", action: "她翻起眼睛，张开嘴伸出舌头，一滴口水落下。" },
  { id: "h3-kiss", label: "接吻", englishLabel: "Passionate Kiss", description: "两名成年人接吻", tags: ["参考图", "亲密", "接吻"], group: "kiss", strength: "1", trigger: "They kiss passionately", weightFile: "Passionate Kissing - MinimaxH3 - They kiss passionately,1str.safetensors", action: "两名成年人靠近，嘴唇贴在一起接吻。" },
  { id: "h3-breast-play", label: "胸部", englishLabel: "Breast Play", description: "双手揉动乳房", tags: ["参考图", "亲密", "胸部"], group: "chest", strength: "0.7", trigger: "squeezes her breasts together", weightFile: "Breast Play & Jiggle v2.0 FL2V+REF - MinimaxH3 - turbo8steps,res_2s+beta57,causing her breasts to jiggle side to side,bounce up and down,woman slaps her breasts,grabs,squeezes her breasts together with her hands,0.7-0.safetensors", action: "她用手抓住乳房挤压，乳房随之晃动。" },
  { id: "h3-ass-jiggle", label: "臀部", englishLabel: "Ass Jiggle", description: "臀部抖动", tags: ["参考图", "亲密", "臀部"], group: "rear", strength: "0.8", trigger: "0.8-1str", weightFile: "Ass jiggle (I2V) - FL2VA & I2V - MinimaxH3 - 0.8-1str.safetensors", action: "她的臀肉左右抖动。" },
  { id: "h3-twerk-pro", label: "臀部", englishLabel: "Twerk Pro", description: "大幅度扭臀", tags: ["参考图", "亲密", "臀部"], group: "rear", strength: "1", trigger: "icytwerk", weightFile: "Icy Twerk Pro MAX v2.0 - MinimaxH3 - icytwerk.safetensors", action: "她大幅度扭动臀部。" },
  { id: "h3-bend", label: "臀部", englishLabel: "Bend and Spread", description: "弯腰分开臀部", tags: ["参考图", "亲密", "臀部"], group: "rear", strength: "1", trigger: "Bend Over", weightFile: "Bend Over & Spread v8400s - MinimaxH3.safetensors", action: "她弯下腰，双手分开臀部。" },
  { id: "h3-tied-sit", label: "捆绑", englishLabel: "Tied Sitting", description: "自愿坐姿捆绑", tags: ["参考图", "亲密", "捆绑"], group: "bound", strength: "0.9", trigger: "tied sitting pose", weightFile: "Tied Sitting - MinimaxH3 - 0.9str,in a tied sitting pose.safetensors", action: "她保持自愿的坐姿捆绑，只做小幅动作。" },
  { id: "h3-spreadeagle", label: "捆绑", englishLabel: "Spread Eagle", description: "自愿仰卧张开四肢", tags: ["参考图", "亲密", "捆绑"], group: "bound", strength: "1", trigger: "spread-eagle pose", weightFile: "Tied Spreadeagle - MiniMaxH3 - tied supine spread-eagle pose.safetensors", action: "她仰卧，四肢以自愿的方式张开固定，身体只轻轻起伏。" },
  { id: "h3-lingerie-blue", label: "内衣", englishLabel: "Blue Lingerie", description: "穿着成人内衣转身", tags: ["参考图", "亲密", "内衣"], group: "lingerie", strength: "1", trigger: "Bluebella Nova Lingerie", weightFile: "Bluebella Nova Lingerie - MinimaxH3 - She is wearing COLOR Bluebella Nova Lingerie.safetensors", action: "她穿着成人内衣，缓慢转身。" },
  { id: "h3-latex", label: "内衣", englishLabel: "Latex", description: "穿着乳胶衣", tags: ["参考图", "亲密", "内衣"], group: "lingerie", strength: "1", trigger: "Latex", weightFile: "Latex clothes - MinimaxH3 - Latex.safetensors", action: "她穿着乳胶衣，身体轻轻扭动。" },
  { id: "h3-thong", label: "内衣", englishLabel: "Thong", description: "穿着丁字裤", tags: ["参考图", "亲密", "内衣"], group: "lingerie", strength: "1", trigger: "thong panties", weightFile: "Thong Panties - MinimaxH3 - She is wearing thong panties.safetensors", action: "她穿着丁字裤，转身让臀部入画。" },
  { id: "h3-micro-bikini", label: "内衣", englishLabel: "Sling Bikini", description: "穿着吊带比基尼", tags: ["参考图", "亲密", "内衣"], group: "lingerie", strength: "1", trigger: "microbikini", weightFile: "Microbikini and Sling Bikini - MinimaxH3 - She is wearing a microbikini-sling bikini.safetensors", action: "她穿着吊带比基尼，胯部缓慢摆动。" },
  { id: "h3-massage", label: "其他", englishLabel: "Massage", description: "成年人物接受按摩", tags: ["参考图", "亲密", "按摩"], group: "other", strength: "0.9", trigger: "sexy massage", weightFile: "Sexy Massage - MinimaxH3 - getting a sexy massage,0.9str.safetensors", action: "她躺着，双手在她的背上和腰侧按摩。" },
  { id: "h3-hip-dance", label: "臀部", englishLabel: "Hip Dance", description: "扭胯跳舞", tags: ["参考图", "亲密", "臀部"], group: "rear", strength: "1", trigger: "sways her hips", weightFile: "Hip Sway Dance - MinimaxH3 - dancing with arms in front.safetensors", action: "她把手放在身前，胯部左右摆动。" },
  { id: "h3-spread", label: "阴部", englishLabel: "Spread", description: "双手分开阴部", tags: ["参考图", "亲密", "阴部"], group: "groin", strength: "1", trigger: "vulva held open", weightFile: "Pussy spread v0.2 - MinimaxH3 - spread,her hands have the vulva held open and centered,her vulva becomes exposed between the opened legs.safetensors", action: "她张开腿，双手把阴部向两侧分开。" },
  { id: "h3-pegging", label: "性交", englishLabel: "Pegging", description: "穿戴式假阳具插入", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "0.5", trigger: "0.5-0.8str", weightFile: "Pegging T2V-I2V - MinimaxH3 - 0.5-0.8str.safetensors", action: "她用穿戴式假阳具从后方插入对方抽送。" },
  { id: "h3-double", label: "多人", englishLabel: "Two Partners", description: "两名成年人同时进入", tags: ["参考图", "亲密", "多人"], group: "group", strength: "1", trigger: "doublefuck", weightFile: "Doublefuck T2V-I2V - MinimaxH3 - doublefuck.safetensors", action: "两名成年人分别从口和阴道进入她，动作保持连续。" },
  { id: "h3-final-thrust", label: "性交", englishLabel: "Final Thrust", description: "交合末段用力抽送并射在体内", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "1", trigger: "intense thrusts", weightFile: "Climax Final Thrust - MinimaxH3 - This video depicts part of sexual intercourse climax, the male character performs powerful, intense thrusts with his penis inside female and cums inside of her.safetensors", action: "交合接近结束时抽送变快，精液留在体内。" },
  { id: "h3-pussyjob", label: "性交", englishLabel: "Pussyjob", description: "阴茎在阴部外侧摩擦", tags: ["参考图", "亲密", "性交"], group: "sex", strength: "0.5", trigger: "PJSLIDE", weightFile: "PJSLIDE - Pussyjob - MinimaxH3 - 0.5str,PJSLIDE,add HMPenis lora at 0.5str.safetensors", action: "阴茎贴着阴部外侧前后摩擦，没有插入。" },
  { id: "h3-orgasm", label: "表情", englishLabel: "Orgasm", description: "成年人物高潮时身体收缩", tags: ["参考图", "亲密", "表情"], group: "face", strength: "1", trigger: "orgasmic contractions", weightFile: "Female Masturbation-Orgasmic Contractions v1.4 - MinimaxH3.safetensors", action: "她达到高潮，小腹和大腿一阵阵收紧。" },
];

export const H3_ACTION_TEMPLATES: readonly GenerationTemplate[] = sources.map(source => ({
  id: source.id,
  kind: "video",
  label: groupLabel(source.group),
  englishLabel: source.englishLabel,
  description: source.description,
  categories: ["intimate"],
  tags: source.tags,
  aspectRatio: "16:9",
  fields: [],
  defaultValues: {},
  demoVideoUrl: `/assets/xumeng/h3-actions/${source.id}.mp4`,
  demoPosterUrl: `/assets/xumeng/h3-actions/${source.id}.webp`,
  pattern: h3Pattern(source.action),
  h3Lora: { repo, weightFile: source.weightFile, strength: source.strength, trigger: source.trigger, group: source.group },
}));
