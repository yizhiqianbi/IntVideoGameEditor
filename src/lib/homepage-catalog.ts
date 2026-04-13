export type ProductLineStatus = "active" | "coming-soon";

export type ProductLine = {
  slug: string;
  title: string;
  subtitle: string;
  status: ProductLineStatus;
  href?: string;
  accent: "primary" | "muted";
};

export type FeaturedCase = {
  id: string;
  title: string;
  category: string;
  status: string;
};

export const PRODUCT_LINES: ProductLine[] = [
  {
    slug: "mv",
    title: "MV",
    subtitle: "音乐叙事与视觉短片",
    status: "coming-soon",
    accent: "muted",
  },
  {
    slug: "interactive-film-game",
    title: "互动影游",
    subtitle: "节点式剧情、角色场景与互动交付",
    status: "active",
    href: "/projects",
    accent: "primary",
  },
  {
    slug: "interactive-game-generator",
    title: "互动游戏生成器",
    subtitle: "规则、剧情与玩法生成",
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
  },
  {
    id: "missed-call",
    title: "未接来电",
    category: "互动影游",
    status: "案例占坑",
  },
  {
    id: "last-tape",
    title: "最后一盘录像带",
    category: "互动影游",
    status: "案例占坑",
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
