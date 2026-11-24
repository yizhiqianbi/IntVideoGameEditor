/** Photographic shelf covers. Files live in public/dzmm/home and are served at /assets/xumeng/home. */

export const XUMENG_DRAMA_COVERS = {
  "hg-5161": "/assets/xumeng/home/cover-su-peizhen.webp",
  "hg-9758": "/assets/xumeng/home/cover-shanghai.webp",
  "hg-2902": "/assets/xumeng/home/cover-weakness.webp",
  "hg-4136": "/assets/xumeng/home/cover-tiangong.webp",
} as const;

/** Published cards whose catalog image is a placeholder or a mismatched illustration. */
const HOME_COVERS: Readonly<Record<string, string>> = {
  "published-abe46fe3-f75e-40b7-b7f8-403e404d356d": "/assets/xumeng/home/cover-linshuang.webp",
  "published-7950ff23-54b6-4cb7-bf33-240a6c660052": "/assets/xumeng/home/cover-miveth.webp",
  "published-fb41037b-e9f1-4bc3-afd4-d80b613c660b": "/assets/xumeng/home/cover-qin.webp",
};

/** Silent looping covers on the recommended and latest shelves. */
const HOME_MOTION: Readonly<Record<string, string>> = {
  "published-abe46fe3-f75e-40b7-b7f8-403e404d356d": "/assets/xumeng/home/motion/shelf-linshuang.mp4?v=3",
  "published-7950ff23-54b6-4cb7-bf33-240a6c660052": "/assets/xumeng/home/motion/shelf-miveth.mp4?v=3",
  "published-fb41037b-e9f1-4bc3-afd4-d80b613c660b": "/assets/xumeng/home/motion/shelf-qin.mp4?v=3",
  "published-a11af9d0-9e82-49a3-8f3d-4443042aa959": "/assets/xumeng/home/motion/shelf-mom.mp4?v=3",
  "published-9781883b-209a-49fa-beb3-d44760472df6": "/assets/xumeng/home/motion/shelf-nun.mp4?v=2",
  "published-fbe35118-e4a8-4dad-9195-c88f25ae318f": "/assets/xumeng/home/motion/shelf-ballet.mp4?v=2",
  "published-501fc1ad-641a-45e4-b091-e3e059d70d2c": "/assets/xumeng/home/motion/shelf-clerk.mp4?v=2",
  "published-a16f0000-0000-4000-8000-0000000086ca": "/assets/xumeng/home/motion/shelf-guan.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000007ae6": "/assets/xumeng/home/motion/shelf-you.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000027718": "/assets/xumeng/home/motion/shelf-mizuko.mp4?v=3",
  "published-a16f0000-0000-4000-8000-00000000c0d3": "/assets/xumeng/home/motion/shelf-yu.mp4?v=3",
  "published-a16f0000-0000-4000-8000-0000000048f6": "/assets/xumeng/home/motion/shelf-su.mp4?v=3",
  "published-4750c8d0-03ea-4227-a865-2c040853d8fa": "/assets/xumeng/home/motion/shelf-top003.mp4?v=3",
  "published-0795a91d-996b-4c28-8549-e83fa056ecb1": "/assets/xumeng/home/motion/shelf-top008.mp4?v=3",
  "published-a16f0000-0000-4000-8000-0000000093a6": "/assets/xumeng/home/motion/shelf-top011.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000008671": "/assets/xumeng/home/motion/shelf-top009.mp4?v=3",
  "published-a16f0000-0000-4000-8000-0000000088ce": "/assets/xumeng/home/motion/shelf-top013.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000028e0f": "/assets/xumeng/home/motion/shelf-top016.mp4?v=3",
  "published-a16f0000-0000-4000-8000-00000002a216": "/assets/xumeng/home/motion/shelf-top015.mp4?v=3",
  "published-a16f0000-0000-4000-8000-00000002925c": "/assets/xumeng/home/motion/shelf-top018.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000008d57": "/assets/xumeng/home/motion/shelf-top020.mp4?v=3",
  "published-a16f0000-0000-4000-8000-0000000090eb": "/assets/xumeng/home/motion/shelf-top019.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000009074": "/assets/xumeng/home/motion/shelf-top024.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000008e6d": "/assets/xumeng/home/motion/shelf-top021.mp4?v=3",
  "published-a16f0000-0000-4000-8000-0000000288d0": "/assets/xumeng/home/motion/shelf-top022.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000007a6b": "/assets/xumeng/home/motion/shelf-top028.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000008ab4": "/assets/xumeng/home/motion/shelf-top025.mp4?v=3",
  "published-a16f0000-0000-4000-8000-00000000525f": "/assets/xumeng/home/motion/shelf-top026.mp4?v=3",
  "published-a16f0000-0000-4000-8000-0000000062e2": "/assets/xumeng/home/motion/shelf-top030.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000000873": "/assets/xumeng/home/motion/shelf-top029.mp4?v=3",
  "published-a16f0000-0000-4000-8000-000000008981": "/assets/xumeng/home/motion/shelf-limei.mp4?v=2",
  "published-e8da5f78-4c32-4105-8022-62054310a2c8": "/assets/xumeng/home/motion/shelf-spring.mp4?v=2",
  "published-a023f23a-ded0-411e-87e1-897b6a97e09d": "/assets/xumeng/home/motion/shelf-baixue.mp4?v=2",
  "published-567b24cc-0ad4-404a-9965-6bcd884c17f6": "/assets/xumeng/home/motion/shelf-sisters.mp4",
  "published-818f767d-a72b-4e03-9e24-62d91a82cff4": "/assets/xumeng/home/motion/shelf-megan.mp4?v=2",
};

export function xumengHomeCover(id: string | undefined): string | undefined {
  return id ? HOME_COVERS[id] : undefined;
}

export function xumengHomeMotion(id: string | undefined): string | undefined {
  return id ? HOME_MOTION[id] : undefined;
}
