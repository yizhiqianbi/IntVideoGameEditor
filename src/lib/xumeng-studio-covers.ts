export const STUDIO_COVER_SLOTS = ["member", "recharge", "invite", "role", "generate", "novel", "girlfriend", "scenario"] as const;

export type StudioCoverSlot = (typeof STUDIO_COVER_SLOTS)[number];

export const STUDIO_COVER_LABELS: Record<StudioCoverSlot, string> = {
  member: "叙梦会员",
  recharge: "充值",
  invite: "邀请",
  role: "创建角色",
  generate: "AI 生成",
  novel: "小说与故事",
  girlfriend: "上传女友",
  scenario: "多人场景",
};

export const STUDIO_COVER_FALLBACKS: Record<StudioCoverSlot, string> = {
  member: "/assets/xumeng/content-covers/promo-member.webp",
  recharge: "/assets/xumeng/content-covers/promo-recharge.webp",
  invite: "/assets/xumeng/content-covers/promo-invite.webp",
  role: "/assets/xumeng/content-covers/create-role.webp",
  generate: "/assets/xumeng/content-covers/create-generate.webp",
  novel: "/assets/xumeng/content-covers/create-novel.webp",
  girlfriend: "/assets/xumeng/content-covers/create-girlfriend.webp",
  scenario: "/assets/xumeng/content-covers/create-scenario.webp",
};

export function isStudioCoverSlot(value: string): value is StudioCoverSlot {
  return (STUDIO_COVER_SLOTS as readonly string[]).includes(value);
}
