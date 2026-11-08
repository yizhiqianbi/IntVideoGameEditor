import type { Shot } from "./drama";
import type { AssetCard } from "./drama-assets";
import { promoteOrphans, remapShotParents } from "./drama-tree";
export type CanvasDocument = { shots: Shot[]; assets: AssetCard[] };
export function removeCards(
  doc: CanvasDocument,
  ids: string[],
): CanvasDocument {
  const removed = new Set(ids);
  return {
    shots: promoteOrphans(doc.shots, ids).map((s) => ({
      ...s,
      assetIds: (s.assetIds || []).filter((id) => !removed.has(id)),
      referenceBindings: Object.fromEntries(Object.entries(s.referenceBindings ?? {}).filter(([, binding]) => !binding.startsWith("asset:") || !removed.has(binding.slice(6)))),
    })),
    assets: doc.assets.filter((a) => !removed.has(a.id)),
  };
}
export function duplicateCards(
  doc: CanvasDocument,
  ids: string[],
): CanvasDocument {
  return pasteCards(doc, copyCards(doc, ids));
}
export function copyCards(doc: CanvasDocument, ids: string[]): CanvasDocument {
  const selected = new Set(ids);
  return structuredClone({
    shots: doc.shots.filter(s => selected.has(s.id)),
    assets: doc.assets.filter(a => selected.has(a.id)),
  });
}
export function pasteCards(
  doc: CanvasDocument,
  clipboard: CanvasDocument,
  at?: { x: number; y: number },
): CanvasDocument {
  clipboard = structuredClone(clipboard);
  const source = [...clipboard.assets, ...clipboard.shots];
  if (!source.length) return doc;
  const mapping = new Map(source.map(card => [card.id, crypto.randomUUID()]));
  const offset = at ? { x: at.x - Math.min(...source.map(c => c.position.x)), y: at.y - Math.min(...source.map(c => c.position.y)) } : { x: 45, y: 45 };
  const move = (card: Shot | AssetCard) => ({ x: card.position.x + offset.x, y: card.position.y + offset.y });
  const assets = clipboard.assets
    .filter((a) => mapping.has(a.id))
    .map((a) => ({
      ...a,
      id: mapping.get(a.id)!,
      title: a.title + " 副本",
      position: move(a),
      positionLocked: false,
    }));
  const availableAssets = new Set([...doc.assets, ...assets].map(a => a.id));
  const shots = clipboard.shots
    .filter((s) => mapping.has(s.id))
    .map((s) => ({
      ...s,
      id: mapping.get(s.id)!,
      title: s.title + " 副本",
      position: move(s),
      positionLocked: false,
      assetIds: (s.assetIds || []).map((id) => mapping.get(id) || id).filter(id => availableAssets.has(id)),
      referenceBindings: Object.fromEntries(Object.entries(s.referenceBindings ?? {}).flatMap(([slot, binding]) => {
        if (!binding.startsWith("asset:")) return [[slot, binding]];
        const id = mapping.get(binding.slice(6)) ?? binding.slice(6);
        return availableAssets.has(id) ? [[slot, `asset:${id}`]] : [];
      })),
      taskId: undefined,
      taskMode: undefined,
      taskProvider: undefined,
      taskVideoModel: undefined,
      status: undefined,
      generationStartedAt: undefined,
      generationFinishedAt: undefined,
      statusUpdatedAt: undefined,
      queuePosition: undefined,
      videoUrl: undefined,
      endStill: undefined,
      endFrameAssetId: undefined,
      startFrameAssetId: undefined,
      error: undefined,
    }));
  return {
    shots: [...doc.shots, ...remapShotParents(shots, mapping).map(s => ({ ...s, parentId: s.parentId && (doc.shots.some(old => old.id === s.parentId) || shots.some(copy => copy.id === s.parentId)) ? s.parentId : undefined }))],
    assets: [...doc.assets, ...assets],
  };
}
