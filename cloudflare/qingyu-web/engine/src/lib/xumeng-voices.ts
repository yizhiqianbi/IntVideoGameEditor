/** Exact provider IDs from Vidu's official voice table. Labels describe a sound style, not an actor's age. */
export const XUMENG_SPEECH_VOICES = [
  { id: "melotts", label: "自然中文", group: "默认", description: "原来的中文朗读声音", provider: "cloudflare", model: "@cf/myshell-ai/melotts" },
  { id: "female-yujie", label: "御姐", group: "女声", description: "沉稳、有姐姐感", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-YiaFlpiWzo4Twkxb.mp3" },
  { id: "female-shaonv", label: "软萌少女", group: "女声", description: "轻盈、偏软萌的声音", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-Zp3xnBAgMpkKN0fb.mp3" },
  { id: "female-tianmei", label: "甜美", group: "女声", description: "明亮、亲切", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-gc9rn0lig2Phdh1g.mp3" },
  { id: "female-chengshu", label: "成熟", group: "女声", description: "成熟、从容", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-HCbEW2grkWSOVYXB.mp3" },
  { id: "male-qn-qingse", label: "青涩青年", group: "男声", description: "清朗、青涩", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-uLeoUwGWiQQZLiKH.mp3" },
  { id: "male-qn-daxuesheng", label: "清爽青年", group: "男声", description: "轻快、日常", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-T4kIZ1khgduPiW2i.mp3" },
  { id: "male-qn-badao", label: "霸道男声", group: "男声", description: "低沉、有力度", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-ypZmFjxo84q476Ds.mp3" },
  { id: "male-qn-jingying", label: "沉稳男声", group: "男声", description: "稳重、清晰", provider: "vidu", model: "vidu-tts", previewUrl: "https://scene.vidu.zone/media-asset/072356-7hgJgP689lvUsESC.mp3" },
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
