export type ProductLineStatus = "active" | "coming-soon";

export type ProductLine = {
  slug: string;
  title: string;
  subtitle: string;
  blurb: string;
  status: ProductLineStatus;
  href?: string;
  accent: "primary" | "muted";
};

export type FeaturedCase = {
  id: string;
  title: string;
  category: string;
  status: string;
  summary: string;
  tone: "violet" | "cyan" | "amber";
};

export const PRODUCT_LINES: ProductLine[] = [
  {
    slug: "mv",
    title: "MV",
    subtitle: "音乐叙事与视觉短片",
    blurb: "把情绪、节奏和画面组织成可生成、可导出的音乐视频工作流。",
    status: "coming-soon",
    accent: "muted",
  },
  {
    slug: "interactive-film-game",
    title: "互动影游",
    subtitle: "节点式剧情、角色场景与互动交付",
    blurb: "围绕角色、场景、镜头和分支，把一部可玩的互动影游从想法推到交付。",
    status: "active",
    href: "/projects",
    accent: "primary",
  },
  {
    slug: "interactive-game-generator",
    title: "互动游戏生成器",
    subtitle: "规则、剧情与玩法生成",
    blurb: "用统一的角色、世界观和规则模板，快速生成可交互的游戏内容。",
    status: "coming-soon",
    accent: "muted",
  },
];

export const FEATURED_CASES: FeaturedCase[] = [
  {
    id: "fog-port",
    title: "雾港回声",
    category: "互动影游",
    status: "精选案例",
    summary: "旧港迷雾、失踪父亲与双重真相，在一部可分叉推进的影游结构里逐步揭开。",
    tone: "violet",
  },
  {
    id: "missed-call",
    title: "未接来电",
    category: "互动影游",
    status: "案例占坑",
    summary: "一通深夜来电把主角拉回十年前的事故现场，分支决定她会追查还是逃离。",
    tone: "cyan",
  },
  {
    id: "last-tape",
    title: "最后一盘录像带",
    category: "互动影游",
    status: "案例占坑",
    summary: "遗失录像、封存仓库和多位证人的版本冲突，适合做多路径观看与追凶叙事。",
    tone: "amber",
  },
];

export function getPrimaryProductLine() {
  return PRODUCT_LINES.find((item) => item.status === "active") ?? PRODUCT_LINES[0];
}

export default {
  PRODUCT_LINES,
  FEATURED_CASES,
  getPrimaryProductLine,
};
