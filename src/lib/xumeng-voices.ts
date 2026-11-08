import { BREEZE_TTS_MODEL, BREEZE_VOICE_PREVIEWS } from "./xumeng-breeze-voices";

/** Exact provider IDs from Vidu's official voice table. Labels describe a sound style, not an actor's age. */
export const XUMENG_SPEECH_VOICE_GROUPS = ["默认", "女声", "男声", "魅魔"] as const;
/** Tavern default. Characters with no saved voice use this when Breeze is configured. */
export const XUMENG_DEFAULT_SPEECH_VOICE = "cRL5y2g9Apu45tuoclY0" as const;
export const XUMENG_SPEECH_VOICES = [
  { id: XUMENG_DEFAULT_SPEECH_VOICE, label: "晚灯", group: "默认", description: "酒馆默认。年轻成年女声，温暖，尾音一层薄沙，像夜里坐近了说话。", provider: "elevenlabs", model: "eleven_multilingual_v2", previewUrl: BREEZE_VOICE_PREVIEWS.warm },
  { id: "melotts", label: "自然中文", group: "默认", description: "原来的中文朗读声音", provider: "cloudflare", model: "@cf/myshell-ai/melotts" },
  { id: "HE2pJq42vZv55x9j9gOh", label: "清川", group: "女声", description: "清晰、克制、自然；适合日常对话", provider: "elevenlabs", model: "eleven_multilingual_v2", previewUrl: "https://storage.googleapis.com/eleven-public-prod/database/workspace/a039efafad594fe799a7b51529e19424/voices/HE2pJq42vZv55x9j9gOh/f032866b-9690-496d-b23b-c41b47a7fc91.mp3" },
  { id: "dGyruSqrNQLp4m4NQbHz", label: "微澜", group: "女声", description: "柔和、低调、有情绪余韵；适合安静场景", provider: "elevenlabs", model: "eleven_multilingual_v2", previewUrl: "https://storage.googleapis.com/eleven-public-prod/database/workspace/a039efafad594fe799a7b51529e19424/voices/dGyruSqrNQLp4m4NQbHz/2f76c70f-5347-478a-95fb-5fa8a8c5d50e.mp3" },
  { id: "BT0SH7Hb8NRPpT5xbCgg", label: "Lulu · 小魔女", group: "女声", description: "台湾普通话、年轻、可爱活泼；适合二次元和游戏角色", provider: "elevenlabs", model: "eleven_multilingual_v2", previewUrl: "https://storage.googleapis.com/eleven-public-prod/database/workspace/451fb4b0fbd844bbb0c30fe416b6498e/voices/BT0SH7Hb8NRPpT5xbCgg/JMJTJG4vYXdZKcbYxLQv.mp3" },
  { id: "female-yujie", label: "御姐", group: "女声", description: "沉稳、有姐姐感", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-YiaFlpiWzo4Twkxb.mp3" },
  { id: "female-shaonv", label: "软萌少女", group: "女声", description: "轻盈、偏软萌的声音", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-Zp3xnBAgMpkKN0fb.mp3" },
  { id: "female-tianmei", label: "甜美", group: "女声", description: "明亮、亲切", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-gc9rn0lig2Phdh1g.mp3" },
  { id: "female-chengshu", label: "成熟", group: "女声", description: "成熟、从容", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-HCbEW2grkWSOVYXB.mp3" },
  { id: "male-qn-qingse", label: "青涩青年", group: "男声", description: "清朗、青涩", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-uLeoUwGWiQQZLiKH.mp3" },
  { id: "male-qn-daxuesheng", label: "清爽青年", group: "男声", description: "轻快、日常", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-T4kIZ1khgduPiW2i.mp3" },
  { id: "male-qn-badao", label: "霸道男声", group: "男声", description: "低沉、有力度", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-ypZmFjxo84q476Ds.mp3" },
  { id: "male-qn-jingying", label: "沉稳男声", group: "男声", description: "稳重、清晰", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-7hgJgP689lvUsESC.mp3" },
  { id: "breeze-whisper", label: "贴耳", group: "魅魔", description: "成年女声。离麦克风两三厘米，气声约占三分之一，慢，尾音拖住，笑留在喉咙里。", provider: "breeze", model: BREEZE_TTS_MODEL, previewUrl: BREEZE_VOICE_PREVIEWS.whisper },
  { id: "breeze-pact", label: "夜契", group: "魅魔", description: "成年女声。中低音，胸腔有厚度，句尾往下沉，只对很近的一个人说。", provider: "breeze", model: BREEZE_TTS_MODEL, previewUrl: BREEZE_VOICE_PREVIEWS.pact },
  { id: "breeze-cling", label: "黏人", group: "魅魔", description: "贴耳的嗓子。音量更小，词之间有气口，尾音黏到下一个字上。", provider: "breeze", model: BREEZE_TTS_MODEL, previewUrl: BREEZE_VOICE_PREVIEWS.whisper },
  { id: "breeze-bite", label: "咬笑", group: "魅魔", description: "夜契的嗓子。句中有压住的轻笑，句尾先扬再落回低音。", provider: "breeze", model: BREEZE_TTS_MODEL, previewUrl: BREEZE_VOICE_PREVIEWS.pact },
] as const;
export type XumengSpeechVoiceId = typeof XUMENG_SPEECH_VOICES[number]["id"];
export const getXumengSpeechVoice = (id: unknown) => XUMENG_SPEECH_VOICES.find(voice => voice.id === id);

/** Vidu S2's own realtime catalog; global Doubao and Qwen IDs must not be mixed. */
export const XUMENG_LIVE_VOICE_OPTIONS = [
  { id: "zh_female_liuchangnv_uranus_bigtts", label: "自然中文 · 流畅", group: "默认", provider: "doubao" },
  { id: "Tina", label: "Tina · 自然女声", group: "默认", provider: "qwen_omni" },
  { id: "Katerina", label: "御姐", group: "女声", provider: "qwen_omni" },
  { id: "Momo", label: "软萌 · 撒娇", group: "女声", provider: "qwen_omni" },
  { id: "Sunnybobi", label: "邻家 · 元气", group: "女声", provider: "qwen_omni" },
  { id: "Liora Mira", label: "温柔", group: "女声", provider: "qwen_omni" },
  { id: "Harvey", label: "低沉 · 温和", group: "男声", provider: "qwen_omni" },
  { id: "Ethan", label: "阳光 · 活力", group: "男声", provider: "qwen_omni" },
  { id: "Evan", label: "清爽青年", group: "男声", provider: "qwen_omni" },
  { id: "Raymond", label: "清亮男声", group: "男声", provider: "qwen_omni" },
] as const;
export const XUMENG_LIVE_VOICES = XUMENG_LIVE_VOICE_OPTIONS.map(voice => voice.id);
export type XumengLiveVoice = typeof XUMENG_LIVE_VOICE_OPTIONS[number]["id"];
export const getXumengLiveVoice = (id: unknown) => XUMENG_LIVE_VOICE_OPTIONS.find(voice => voice.id === id);

/**
 * Realtime calls cannot use the Breeze timbre directly. This picks the closest
 * catalog voice so a chat voice and a video call stay in the same range.
 */
export function liveVoiceForSpeech(id: unknown): XumengLiveVoice {
  switch (id) {
    case "female-yujie":
    case "female-chengshu":
    case "breeze-pact":
    case "breeze-bite":
      return "Katerina";
    case "female-shaonv":
      return "Momo";
    case "female-tianmei":
      return "Sunnybobi";
    case "dGyruSqrNQLp4m4NQbHz":
    case "BT0SH7Hb8NRPpT5xbCgg":
    case "breeze-whisper":
    case "breeze-cling":
      return "Liora Mira";
    case "male-qn-qingse":
    case "male-qn-daxuesheng":
      return "Evan";
    case "male-qn-badao":
    case "male-qn-jingying":
      return "Harvey";
    default:
      return "zh_female_liuchangnv_uranus_bigtts";
  }
}
