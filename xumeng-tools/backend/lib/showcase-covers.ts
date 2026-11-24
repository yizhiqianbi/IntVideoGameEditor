/** 首页和广告位用的肖像。模板画廊仍走原来的动作封面。 */
const SHOWCASE: Record<string, string> = {
  "template-image": "/covers/cover-freya.jpg",
  "text-image": "/covers/cover-greta.jpg",
  "image-edit": "/covers/cover-elise.jpg",
  "two-image": "/covers/cover-sage.jpg",
  "face-image": "/covers/cover-nora.jpg",
  "undress-image": "/covers/cover-iris.jpg",
  "scene-image": "/covers/cover-dahlia.jpg",
  "couple-image": "/covers/cover-helena.jpg",
  "template-video": "/covers/cover-iris.jpg",
  "text-video": "/covers/cover-freya.jpg",
  "image-video": "/covers/cover-elise.jpg",
  "reference-video": "/covers/cover-dahlia.jpg",
  "frames-video": "/covers/cover-greta.jpg",
  "audio-video": "/covers/cover-helena.jpg",
  "motion-video": "/covers/cover-nora.jpg",
  "face-video": "/covers/cover-sage.jpg",
  "undress-video": "/covers/cover-freya.jpg",
  "scene-video": "/covers/cover-elise.jpg",
  "watermark-video": "/covers/cover-dahlia.jpg",
  speech: "/covers/cover-helena.jpg",
  "voice-clone": "/covers/cover-nora.jpg",
  "dub-video": "/covers/cover-sage.jpg",
};

export function showcaseCover(id: string): string {
  return SHOWCASE[id] ?? "";
}
