/** Keep visible rows and their acknowledged metadata when a later page overlaps. */
export function appendDzmmForumPage<T extends { id: string }>(previous: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(previous.map((item) => item.id));
  const additions: T[] = [];
  for (const item of incoming) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    additions.push(item);
  }
  return [...previous, ...additions];
}

/** Offset pages consume every returned row, including rows already visible. */
export function nextDzmmForumOffset(offset: number, incoming: readonly unknown[]): number {
  return offset + incoming.length;
}

export function retainAcknowledgedForumPost<T>(incoming: T, acknowledged: { revision: number; post: T } | undefined, readRevision: number): T {
  return acknowledged && acknowledged.revision !== readRevision ? acknowledged.post : incoming;
}

export function captureAcknowledgedForumRevisions(acknowledged: ReadonlyMap<string, { revision: number }>): ReadonlyMap<string, number> {
  return new Map(Array.from(acknowledged, ([id, value]) => [id, value.revision]));
}

export function retainAcknowledgedForumPosts<T extends { id: string }>(incoming: readonly T[], acknowledged: ReadonlyMap<string, { revision: number; post: T }>, readRevisions: ReadonlyMap<string, number>): T[] {
  return incoming.map(post => retainAcknowledgedForumPost(post, acknowledged.get(post.id), readRevisions.get(post.id) ?? 0));
}
