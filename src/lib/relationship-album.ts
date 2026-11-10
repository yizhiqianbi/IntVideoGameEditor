import { shanghaiDayKey } from "./shanghai-time";

export type RelationshipAlbumKind = "image" | "video";
export type RelationshipAlbumItem = {
  id: string;
  kind: RelationshipAlbumKind;
  createdAt: number;
  mimeType: string;
};
export type RelationshipAlbumGroup = {
  day: string;
  label: string;
  items: RelationshipAlbumItem[];
};

const ALBUM_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function relationshipAlbumAssetUrl(id: string): string {
  return `/api/backend/v1/relationship-album/assets/${id}`;
}

export function albumDayLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${Number(year)}年${Number(month)}月${Number(date)}日`;
}

export function groupRelationshipAlbum(items: readonly RelationshipAlbumItem[]): RelationshipAlbumGroup[] {
  const groups: RelationshipAlbumGroup[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.createdAt)) continue;
    const day = shanghaiDayKey(item.createdAt);
    const current = groups.at(-1);
    if (current?.day === day) current.items.push(item);
    else groups.push({ day, label: albumDayLabel(day), items: [item] });
  }
  return groups;
}

export function parseRelationshipAlbum(value: unknown): RelationshipAlbumItem[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return [];
  return (value as { items: unknown[] }).items.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; kind?: unknown; createdAt?: unknown; mimeType?: unknown };
    if (typeof row.id !== "string" || !ALBUM_ID.test(row.id)) return [];
    if (row.kind !== "image" && row.kind !== "video") return [];
    if (typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt) || row.createdAt < 0) return [];
    if (typeof row.mimeType !== "string" || row.mimeType.length > 80) return [];
    return [{ id: row.id, kind: row.kind, createdAt: row.createdAt, mimeType: row.mimeType }];
  });
}

export function relationshipMediaObjectKey(url: string): string | null {
  const match = /\/v1\/media\/([A-Za-z0-9-]+\/[a-f0-9-]+\.(?:png|jpe?g|webp|gif))$/.exec(url);
  return match?.[1] ?? null;
}

export async function rememberRelationshipStill(characterId: string, url: string): Promise<void> {
  const objectKey = relationshipMediaObjectKey(url);
  const roleId = characterId.trim();
  if (!objectKey || !roleId) return;
  await fetch("/api/backend/v1/relationship-album", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId: roleId, objectKey }),
  });
}
