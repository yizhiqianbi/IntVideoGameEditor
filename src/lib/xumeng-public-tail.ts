export type XumengPublicTailLink = {
  href: string;
  label: string;
  external: boolean;
};

/** Crawlable product and peer links. Real people and fan sites stay out of this list. */
export const XUMENG_PUBLIC_TAIL_LINKS: readonly XumengPublicTailLink[] = [
  { href: "https://huangguo.chat/", label: "黄果", external: true },
  { href: "https://video.xumengchat.top/", label: "AI成人短剧", external: true },
  { href: "/characters", label: "角色卡", external: false },
  { href: "https://candy.ai/", label: "Candy.ai", external: true },
  { href: "https://crushon.ai/", label: "CrushOn", external: true },
  { href: "https://spicychat.ai/", label: "SpicyChat", external: true },
  { href: "https://janitorai.com/", label: "JanitorAI", external: true },
  { href: "https://character.ai/", label: "Character.AI", external: true },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function xumengPublicTailHtml(): string {
  return XUMENG_PUBLIC_TAIL_LINKS.map(link => {
    const external = link.external ? ` target="_blank" rel="noopener noreferrer"` : "";
    return `<a href="${escapeHtml(link.href)}"${external}>${escapeHtml(link.label)}</a>`;
  }).join(" · ");
}
