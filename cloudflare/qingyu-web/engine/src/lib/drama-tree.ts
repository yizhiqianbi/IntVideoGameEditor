import type { Shot } from "./drama";

export function shotParentId(shot: Pick<Shot, "parentId">) {
  return shot.parentId?.trim() || undefined;
}

export function shotChildren(shots: Shot[], parentId: string) {
  return shots.filter((shot) => shotParentId(shot) === parentId);
}

export function shotRoots(shots: Shot[]) {
  const ids = new Set(shots.map((shot) => shot.id));
  return shots.filter((shot) => {
    const parentId = shotParentId(shot);
    return !parentId || !ids.has(parentId);
  });
}

export function walkShotTree(shots: Shot[]) {
  const seen = new Set<string>();
  const ordered: Shot[] = [];
  const visit = (shot: Shot) => {
    if (seen.has(shot.id)) return;
    seen.add(shot.id);
    ordered.push(shot);
    for (const child of shotChildren(shots, shot.id)) visit(child);
  };
  for (const root of shotRoots(shots)) visit(root);
  for (const shot of shots) visit(shot);
  return ordered;
}

export function shotDepth(shots: Shot[], shotId: string) {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  let depth = 0;
  let current = byId.get(shotId);
  const seen = new Set<string>();
  while (current) {
    const parentId = shotParentId(current);
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    current = byId.get(parentId);
    if (!current) break;
    depth += 1;
  }
  return depth;
}

export function shotEdges(shots: Shot[]) {
  const ids = new Set(shots.map((shot) => shot.id));
  return shots.flatMap((shot) => {
    const parentId = shotParentId(shot);
    if (!parentId || !ids.has(parentId) || parentId === shot.id) return [];
    return [{ id: `${parentId}-${shot.id}`, source: parentId, target: shot.id }];
  });
}

function canReachShot(shots: Shot[], fromId: string, toId: string) {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === toId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of shotChildren(shots, id)) stack.push(child.id);
  }
  return false;
}

export function validateShotLink(
  shots: Shot[],
  parentId: string,
  childId: string,
) {
  if (!parentId || !childId || parentId === childId)
    return "镜头不能连回自己。";
  const parent = shots.find((shot) => shot.id === parentId);
  const child = shots.find((shot) => shot.id === childId);
  if (!parent || !child) return "只能连接两个镜头。";
  if (shotParentId(child) === parentId) return "这条后续已经存在。";
  if (shotParentId(child) && shotParentId(child) !== parentId)
    return "每个镜头只能有一个上一镜。先断开原连接。";
  if (canReachShot(shots, childId, parentId)) return "镜头树不能形成环。";
  return "";
}

export function linkShot(shots: Shot[], parentId: string, childId: string) {
  const error = validateShotLink(shots, parentId, childId);
  if (error) return error;
  return shots.map((shot) =>
    shot.id === childId ? { ...shot, parentId } : shot,
  );
}

export function unlinkShot(shots: Shot[], childId: string) {
  return shots.map((shot) =>
    shot.id === childId ? { ...shot, parentId: undefined } : shot,
  );
}

export function attachNewShot(shots: Shot[], shot: Shot, parentId?: string) {
  const parent = parentId ? shots.find((item) => item.id === parentId) : undefined;
  const siblings = parent ? shotChildren(shots, parent.id) : shotRoots(shots);
  return {
    ...shot,
    parentId: parent?.id,
    position: parent
      ? {
          x: parent.position.x + 360,
          y: parent.position.y + siblings.length * 180,
        }
      : {
          x: 40,
          y: siblings.length * 340,
        },
  };
}

export function promoteOrphans(shots: Shot[], removedIds: string[]) {
  const removed = new Set(removedIds);
  const parentOf = new Map(
    shots.map((shot) => [shot.id, shotParentId(shot)] as const),
  );
  const remaining = shots.filter((shot) => !removed.has(shot.id));
  const remainingIds = new Set(remaining.map((shot) => shot.id));
  return remaining.map((shot) => {
    let parentId = shotParentId(shot);
    const seen = new Set<string>();
    while (parentId && removed.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = parentOf.get(parentId);
    }
    if (parentId && !remainingIds.has(parentId)) parentId = undefined;
    return { ...shot, parentId };
  });
}

export function remapShotParents(
  shots: Shot[],
  mapping: Map<string, string>,
) {
  return shots.map((shot) => {
    const parentId = shotParentId(shot);
    if (!parentId) return { ...shot, parentId: undefined };
    return { ...shot, parentId: mapping.get(parentId) || parentId };
  });
}

export function layoutShotTree(shots: Shot[]) {
  const column = 360;
  const row = 340;
  const positions = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  const place = (shot: Shot, depth: number) => {
    const children = shotChildren(shots, shot.id);
    if (!children.length) {
      positions.set(shot.id, { x: depth * column, y: leaf * row });
      leaf += 1;
      return;
    }
    const start = leaf;
    for (const child of children) place(child, depth + 1);
    positions.set(shot.id, {
      x: depth * column,
      y: ((start + leaf - 1) / 2) * row,
    });
  };
  for (const root of shotRoots(shots)) place(root, 0);
  return shots.map((shot) => ({
    ...shot,
    position: positions.get(shot.id) || shot.position,
  }));
}

export function migrateLinearShotTree(shots: Shot[], declared: boolean) {
  const ids = new Set(shots.map((shot) => shot.id));
  const cleaned = shots.map((shot) => {
    const parentId = shotParentId(shot);
    return {
      ...shot,
      parentId:
        parentId && ids.has(parentId) && parentId !== shot.id
          ? parentId
          : undefined,
    };
  });
  if (declared || cleaned.some((shot) => shotParentId(shot))) return cleaned;
  return cleaned.map((shot, index) =>
    index === 0 ? shot : { ...shot, parentId: cleaned[index - 1].id },
  );
}

export function moveShotAmongSiblings(shots: Shot[], shotId: string, delta: number) {
  const current = shots.find((shot) => shot.id === shotId);
  if (!current) return shots;
  const parentId = shotParentId(current);
  const siblingIds = (
    parentId ? shotChildren(shots, parentId) : shotRoots(shots)
  ).map((shot) => shot.id);
  const from = siblingIds.indexOf(shotId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= siblingIds.length) return shots;
  const nextSiblings = [...siblingIds];
  [nextSiblings[from], nextSiblings[to]] = [nextSiblings[to], nextSiblings[from]];
  const order = new Map(nextSiblings.map((id, index) => [id, index]));
  return [...shots].sort((left, right) => {
    const leftOrder = order.get(left.id);
    const rightOrder = order.get(right.id);
    if (leftOrder === undefined || rightOrder === undefined) {
      return shots.indexOf(left) - shots.indexOf(right);
    }
    return leftOrder - rightOrder;
  });
}

export function dramaBranchCount(shots: Shot[]) {
  return shots.filter((shot) => shotChildren(shots, shot.id).length > 1).length;
}
