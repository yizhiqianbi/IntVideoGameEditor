export const KREA2_STYLES = [
  { id: "photo", label: "写实摄影", text: "Photorealistic photograph, natural skin, sharp detail." },
  { id: "cinema", label: "电影光", text: "Cinematic film still, motivated lighting, shallow depth of field." },
  { id: "soft", label: "柔光", text: "Soft diffused photograph, gentle light, smooth skin." },
  { id: "film", label: "胶片", text: "35mm film photograph, fine grain, natural color." },
  { id: "anime", label: "动漫", text: "Anime illustration of an adult, clean colors, stylized." },
] as const;

export type Krea2StyleId = typeof KREA2_STYLES[number]["id"];

export function krea2StyleText(id: string): string {
  return KREA2_STYLES.find(item => item.id === id)?.text ?? KREA2_STYLES[0].text;
}
