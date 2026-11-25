/**
 * Character Comments domain logic & hybrid API + localStorage persistence.
 *
 * Uses `/api/backend/v1/characters/:id/comments` when available, and seamlessly
 * falls back to localStorage so interactive commenting, liking, replying, sorting,
 * and deleting work offline and in local preview without losing state.
 */

export type XumengCommentSort = "hot" | "latest";

export type XumengCommentTagId = "persona" | "writing" | "plot" | "slowburn" | "immersive";

export interface XumengCommentReply {
  id: string;
  authorId: string;
  authorName: string;
  isCreator?: boolean;
  body: string;
  createdAt: number;
}

export interface XumengComment {
  id: string;
  characterId: string;
  authorId: string;
  authorName: string;
  isCreator?: boolean;
  body: string;
  tags?: XumengCommentTagId[];
  likes: number;
  likedBy: string[];
  replies: XumengCommentReply[];
  createdAt: number;
}

export const XUMENG_COMMENT_MAX_LENGTH = 500;
const STORAGE_KEY = "xumeng:character-comments:v1";

export const XUMENG_COMMENT_TAGS: ReadonlyArray<{
  id: XumengCommentTagId;
  zhHans: string;
  en: string;
  zhHant: string;
  ja: string;
  ko: string;
}> = [
  { id: "persona", zhHans: "人设带感", en: "Great persona", zhHant: "人設帶感", ja: "キャラ最高", ko: "캐릭터 매력적" },
  { id: "writing", zhHans: "文笔惊艳", en: "Vivid prose", zhHant: "文筆驚豔", ja: "文体が美しい", ko: "필력 최고" },
  { id: "plot", zhHans: "剧情上头", en: "Addictive plot", zhHant: "劇情上頭", ja: "展開が熱い", ko: "스토리 몰입" },
  { id: "immersive", zhHans: "氛围沉浸", en: "Immersive vibe", zhHant: "氛圍沉浸", ja: "没入感抜群", ko: "분위기 최고" },
  { id: "slowburn", zhHans: "慢热耐玩", en: "Slow burn", zhHant: "慢熱耐玩", ja: "じっくり遊べる", ko: "서사 탄탄" },
];

export function validateCommentBody(raw: string): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > XUMENG_COMMENT_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}

export function sortXumengComments(list: readonly XumengComment[], sort: XumengCommentSort): XumengComment[] {
  const copy = [...list];
  if (sort === "latest") {
    return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
  return copy.sort((a, b) => {
    const scoreA = a.likes * 3 + a.replies.length * 2;
    const scoreB = b.likes * 3 + b.replies.length * 2;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.createdAt - a.createdAt;
  });
}

export function toggleCommentLikeInList(
  list: readonly XumengComment[],
  commentId: string,
  viewerId: string,
): XumengComment[] {
  return list.map((item) => {
    if (item.id !== commentId) return item;
    const exists = item.likedBy.includes(viewerId);
    const likedBy = exists ? item.likedBy.filter((id) => id !== viewerId) : [...item.likedBy, viewerId];
    const likes = Math.max(0, item.likes + (exists ? -1 : 1));
    return { ...item, likes, likedBy };
  });
}

export function addReplyInList(
  list: readonly XumengComment[],
  commentId: string,
  reply: XumengCommentReply,
): XumengComment[] {
  return list.map((item) =>
    item.id === commentId ? { ...item, replies: [...item.replies, reply] } : item,
  );
}

export function removeCommentInList(list: readonly XumengComment[], commentId: string, viewerId: string): XumengComment[] {
  return list
    .filter((item) => !(item.id === commentId && item.authorId === viewerId))
    .map((item) => ({
      ...item,
      replies: item.replies.filter((rep) => !(rep.id === commentId && rep.authorId === viewerId)),
    }));
}

function readAllStoredComments(): Record<string, XumengComment[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, XumengComment[]>) : {};
  } catch {
    return {};
  }
}

function writeCharacterStoredComments(characterId: string, comments: XumengComment[]): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAllStoredComments();
    all[characterId] = comments.slice(0, 200);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota errors in private browsing.
  }
}

function buildStarterComments(characterId: string, characterName: string): XumengComment[] {
  const now = Date.now();
  const display = characterName.length > 14 ? `${characterName.slice(0, 14)}…` : characterName;
  return [
    {
      id: `seed-${characterId}-1`,
      characterId,
      authorId: "seed-reader-1",
      authorName: "夜航船",
      body: `开场氛围直接拉满！用「（详细描写）」配合慢热推进，${display}的眼神戏和反差感写得特别细腻。`,
      tags: ["persona", "immersive"],
      likes: 24,
      likedBy: [],
      replies: [
        {
          id: `seed-${characterId}-1-r1`,
          authorId: "seed-reader-2",
          authorName: "林间拾光",
          body: "同感！点右上角眼睛切纯净看图再配半透明气泡，代入感超级强。",
          createdAt: now - 1000 * 60 * 48,
        },
      ],
      createdAt: now - 1000 * 60 * 140,
    },
    {
      id: `seed-${characterId}-2`,
      characterId,
      authorId: "seed-reader-3",
      authorName: "白雾咖啡",
      body: "建议多用「（内心：）」和「（旁白：）」来拉扯张力，对话的拉扯感会比直接推进好玩很多。",
      tags: ["writing", "plot"],
      likes: 15,
      likedBy: [],
      replies: [],
      createdAt: now - 1000 * 60 * 320,
    },
  ];
}

export async function loadCharacterComments(characterId: string, characterName: string): Promise<XumengComment[]> {
  // Attempt remote backend first; gracefully fall back to local persistence if endpoint is not yet deployed.
  try {
    const res = await fetch(`/api/backend/v1/characters/${encodeURIComponent(characterId)}/comments`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { comments?: XumengComment[] };
      if (Array.isArray(data.comments)) {
        writeCharacterStoredComments(characterId, data.comments);
        return data.comments;
      }
    }
  } catch {
    // Offline or local preview fallback.
  }

  const all = readAllStoredComments();
  if (Array.isArray(all[characterId])) return all[characterId];
  const seeded = buildStarterComments(characterId, characterName);
  writeCharacterStoredComments(characterId, seeded);
  return seeded;
}

export async function postCharacterComment(
  characterId: string,
  payload: { authorId: string; authorName: string; isCreator?: boolean; body: string; tags?: XumengCommentTagId[] },
  current: readonly XumengComment[],
): Promise<XumengComment[]> {
  const created: XumengComment = {
    id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    characterId,
    authorId: payload.authorId,
    authorName: payload.authorName,
    isCreator: payload.isCreator,
    body: payload.body,
    tags: payload.tags?.length ? payload.tags : undefined,
    likes: 0,
    likedBy: [],
    replies: [],
    createdAt: Date.now(),
  };

  try {
    const res = await fetch(`/api/backend/v1/characters/${encodeURIComponent(characterId)}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as { comment?: XumengComment; comments?: XumengComment[] };
      if (Array.isArray(data.comments)) {
        writeCharacterStoredComments(characterId, data.comments);
        return data.comments;
      }
      if (data.comment) {
        const next = [data.comment, ...current];
        writeCharacterStoredComments(characterId, next);
        return next;
      }
    }
  } catch {
    // Fall through to local persistence.
  }

  const next = [created, ...current];
  writeCharacterStoredComments(characterId, next);
  return next;
}

export async function postCharacterCommentReply(
  characterId: string,
  commentId: string,
  payload: { authorId: string; authorName: string; isCreator?: boolean; body: string },
  current: readonly XumengComment[],
): Promise<XumengComment[]> {
  const reply: XumengCommentReply = {
    id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    authorId: payload.authorId,
    authorName: payload.authorName,
    isCreator: payload.isCreator,
    body: payload.body,
    createdAt: Date.now(),
  };

  try {
    await fetch(`/api/backend/v1/characters/${encodeURIComponent(characterId)}/comments/${encodeURIComponent(commentId)}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Persist locally below.
  }

  const next = addReplyInList(current, commentId, reply);
  writeCharacterStoredComments(characterId, next);
  return next;
}

export async function toggleCharacterCommentLike(
  characterId: string,
  commentId: string,
  viewerId: string,
  current: readonly XumengComment[],
): Promise<XumengComment[]> {
  const next = toggleCommentLikeInList(current, commentId, viewerId);
  writeCharacterStoredComments(characterId, next);
  try {
    await fetch(`/api/backend/v1/characters/${encodeURIComponent(characterId)}/comments/${encodeURIComponent(commentId)}/like`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId }),
    });
  } catch {
    // Local optimistic update already stored.
  }
  return next;
}

export async function deleteCharacterComment(
  characterId: string,
  commentId: string,
  viewerId: string,
  current: readonly XumengComment[],
): Promise<XumengComment[]> {
  const next = removeCommentInList(current, commentId, viewerId);
  writeCharacterStoredComments(characterId, next);
  try {
    await fetch(`/api/backend/v1/characters/${encodeURIComponent(characterId)}/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
    });
  } catch {
    // Local update already stored.
  }
  return next;
}
