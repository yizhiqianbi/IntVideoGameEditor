/** Saved Breeze TTS 2 voices for this studio. The account can keep five timbres. */
export const BREEZE_TTS_MODEL = "breeze-tts-2";

const WARM = "voc_htauzr65pags";
const SISTER = "voc_pdww9yse42mt";
const MALE = "voc_hswtneb9csk4";
const WHISPER = "voc_wqm64duyp9rj";
const PACT = "voc_h8p79dct7fdn";

export const BREEZE_VOICE_PREVIEWS = {
  warm: "https://r.breeze.blue/production/generated/audio/voice-preview/4e/36/4e36368e-f155-5f4b-9dfa-c7275d91e85b.mp3",
  sister: "https://r.breeze.blue/production/generated/audio/voice-preview/0e/a7/0ea7724a-ba3c-50cf-8b72-1fbf8bd38fd0.mp3",
  male: "https://r.breeze.blue/production/generated/audio/voice-preview/4a/f5/4af550af-9519-523d-ac6a-811441fa69a7.mp3",
  whisper: "https://r.breeze.blue/production/generated/audio/voice-preview/82/08/82086274-972d-567e-a32d-8d2bc2ce55ea.mp3",
  pact: "https://r.breeze.blue/production/generated/audio/voice-preview/7c/2d/7c2de6ff-cdd8-5e2f-9bf3-c040dc0f6aa0.mp3",
} as const;

/** Identity prompts used to design the five saved timbres. Delivery notes below steer a line, not a new voice. */
export const BREEZE_VOICE_PROMPTS = {
  warm: "一位年轻成年女性，北京普通话。音高中等，温暖，尾音只有很薄的一层沙。嘴离麦克风大约一掌，气声很少，音量像室内正常说话。语速接近日常，句中有一处自然的短停，不拖腔。字头清楚，韵母圆，不咬得过重。像夜里坐得很近，把话说给对面的人，亲近，但不压成耳语。不尖，不幼，不笑场，不故意压低。",
  sister: "一位成年女性，北京普通话。中低音，胸腔稳住，气声几乎没有。字头干净，尾音收到字上，不拖。语速偏慢半拍，停顿短，像一句说完再等对方。音量正常，距离大约一臂，稳定，不凑到耳边。从容，清楚，有一点姐姐的分寸。不软，不尖，不幼，不压成男声，不加重语气训人。",
  male: "一位年轻成年男性，北京普通话。声音偏低，清楚，胸腔有支撑，喉咙不挤。气声很少，不沙。语速从容，一句里只停一次，重音落在实词上。字头整，尾音收干净，不拖。音量稳定，像面对面把事情说完。不油，不轻快，不压到发闷，不吼。",
  whisper: "一位成年女性，北京普通话，声线年轻但不幼。音高中等略低。嘴离麦克风两三厘米，气声大约占三分之一，字头轻，韵母带一点细沙。语速慢，一句里有两处很短的吸气。尾音不收干净，轻轻拖住再落下。笑意只留在喉咙里，不笑出声。音量小，只说给面前一个人。亲近，慢，带一点挑逗。不喊，不尖，不装小孩，不把气声做成喘息。",
  pact: "一位成年女性，北京普通话。中低音，胸腔有厚度，字像被一层光滑的声音裹住，咬字仍然清楚。气声很薄，只贴在字的边缘，不糊。语速慢，重音落在句尾并往下沉半度。停顿短而稳，不急着填。像关了灯、距离很近、只对一个人说话。从容，带一点占有，不凶。不压成男声，不尖，不幼，不笑出声。",
} as const;

export type BreezeSpeechRoute = { voiceId: string; instructions?: string };

/**
 * Catalog voice id -> saved Breeze timbre, plus a Chinese delivery instruction when
 * the line should not use that timbre's default performance.
 */
const ROUTES: Record<string, BreezeSpeechRoute> = {
  melotts: { voiceId: WARM },
  cRL5y2g9Apu45tuoclY0: { voiceId: WARM },
  HE2pJq42vZv55x9j9gOh: { voiceId: WARM, instructions: "收掉亲近感。咬字更齐，气声再少一点，语速平稳，一句里不停太久。情绪放在句子里面，不外露，不压低，不拖尾音。" },
  dGyruSqrNQLp4m4NQbHz: { voiceId: WARM, instructions: "音量小一档，音高略降。语速放慢，字和字之间留很短的空隙。句尾不要收死，留一点很轻的余韵。安静，不耳语，不笑。" },
  BT0SH7Hb8NRPpT5xbCgg: { voiceId: WARM, instructions: "轻一点，软一点，亮度提高少许。语速稍慢，字头不要咬重。用成年女性的台湾普通话，尾音可以软，但不拉长，不装小孩，不尖。" },
  "female-yujie": { voiceId: SISTER },
  "female-shaonv": { voiceId: WARM, instructions: "轻、软、明亮。语速稍慢，音量正常。字头轻，尾音短。是成年女性的软，不提高成童声，不尖，不拖。" },
  "female-tianmei": { voiceId: WARM, instructions: "亮度清楚，句首可以带一点很轻的笑意，笑不盖过字。语速自然，咬字仍然清楚，尾音收短。亲切，不耳语，不幼。" },
  "female-chengshu": { voiceId: SISTER, instructions: "再慢半拍。停顿更稳，尾音收干净。距离保持一臂，不凑近，不软下来。" },
  "male-qn-qingse": { voiceId: MALE, instructions: "音高抬一点，亮度增加，语速略快。胸腔还在，咬字清楚。不油，不轻飘，不拖。" },
  "male-qn-daxuesheng": { voiceId: MALE, instructions: "语速轻快一点，字头干净，尾音短。音量正常，像日常说话，不压低，不拖。" },
  "male-qn-badao": { voiceId: MALE, instructions: "音高再低一点，字头更重，但不要吼，不要挤喉咙。语速保持从容，尾音收住。力度在咬字上，不在音量上。" },
  "male-qn-jingying": { voiceId: MALE },
  "breeze-whisper": { voiceId: WHISPER },
  "breeze-pact": { voiceId: PACT },
  "breeze-cling": { voiceId: WHISPER, instructions: "再近一点，音量再小一档。词和词之间留一个很轻的气口，上一个字的尾音黏到下一个字上，不要马上放开。声线保持成年女性，软，但不提高、不尖、不装幼。像把一句撒娇贴着对方说完。" },
  "breeze-bite": { voiceId: PACT, instructions: "距离再压近。句中带一点含在气声里的轻笑，笑不盖过字。咬字仍然清楚。句尾先轻轻往上扬一点，再落回原来的低音。节奏偏慢，像在逗对面的人接下一句。不尖叫，不连续笑，不装幼。" },
};

export function breezeSpeechFor(voiceId: string): BreezeSpeechRoute | undefined {
  return ROUTES[voiceId];
}
