export type XumengPublicTailLink = {
  href: string;
  label: string;
  external: boolean;
  rel?: string;
};

/** Crawlable first-party ecosystem and internal SEO/GEO hub links. */
export const XUMENG_PUBLIC_TAIL_LINKS: readonly XumengPublicTailLink[] = [
  { href: "https://huangguo.chat/", label: "黄果", external: true },
  { href: "https://video.xumengchat.top/", label: "AI互动短剧", external: true },
  { href: "/characters", label: "精选角色卡", external: false },
  { href: "/tags", label: "题材标签", external: false },
  { href: "/alternatives/character-ai", label: "Character.AI 替代对比", external: false },
  { href: "/guides/character-card-worldbook", label: "角色卡与世界书指南", external: false },
  { href: "/guides/ai-interactive-drama", label: "互动短剧指南", external: false },
  { href: "/about", label: "关于叙梦", external: false },
  { href: "/faq", label: "常见问题", external: false },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function xumengPublicTailHtml(): string {
  return XUMENG_PUBLIC_TAIL_LINKS.map(link => {
    const rel = link.rel ?? (link.external ? "noopener noreferrer" : "");
    const external = link.external ? ` target="_blank" rel="${escapeHtml(rel)}"` : rel ? ` rel="${escapeHtml(rel)}"` : "";
    return `<a href="${escapeHtml(link.href)}"${external}>${escapeHtml(link.label)}</a>`;
  }).join(" · ");
}
