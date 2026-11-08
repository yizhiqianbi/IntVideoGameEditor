import type { XumengLiveVoice } from "@/lib/xumeng-voices";

/**
 * 打电话用的音色。语音条不走这里，由伴侣容器按 COMPANION_PERSONA 选 Breeze 嗓子。
 * 实时通话还是现有目录，选最接近的一副。
 */
const GIRLFRIEND_LIVE_VOICES: Record<string, XumengLiveVoice> = {
  classic: "zh_female_liuchangnv_uranus_bigtts",
  "lin-cheng": "zh_female_liuchangnv_uranus_bigtts",
  intimate: "Momo",
  qiaowan: "Liora Mira",
  "xu-tang": "Liora Mira",
  tangtang: "Sunnybobi",
  "zhou-man": "Sunnybobi",
  peiwan: "Katerina",
  "jiang-wanhe": "Katerina",
  sales: "Katerina",
  qwen: "zh_female_liuchangnv_uranus_bigtts",
};

export function girlfriendLiveVoice(id: string): XumengLiveVoice {
  return GIRLFRIEND_LIVE_VOICES[id] ?? "zh_female_liuchangnv_uranus_bigtts";
}
