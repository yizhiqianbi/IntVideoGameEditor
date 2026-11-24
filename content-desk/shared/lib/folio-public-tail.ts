export type FolioPublicTailLink = {
  href: string;
  label: string;
  external: boolean;
};

/** Crawlable product and peer links. Real people and fan sites stay out of this list. */
export const FOLIO_PUBLIC_TAIL_LINKS: readonly FolioPublicTailLink[] = [
  { href: "/", label: "黄果", external: true },
  { href: "http://127.0.0.1:5174/", label: "AI成人短剧", external: true },
  { href: "/characters", label: "角色卡", external: false },
  { href: "/", label: "Candy.ai", external: true },
  { href: "/", label: "CrushOn", external: true },
  { href: "/", label: "SpicyChat", external: true },
  { href: "/", label: "JanitorAI", external: true },
  { href: "/", label: "Character.AI", external: true },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function folioPublicTailHtml(): string {
  return FOLIO_PUBLIC_TAIL_LINKS.map(link => {
    const external = link.external ? ` target="_blank" rel="noopener noreferrer"` : "";
    return `<a href="${escapeHtml(link.href)}"${external}>${escapeHtml(link.label)}</a>`;
  }).join(" · ");
}
