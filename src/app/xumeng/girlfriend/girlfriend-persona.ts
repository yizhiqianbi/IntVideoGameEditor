import type { CompanionProfile } from "./companion-profiles";
import type { CompanionStyle } from "./companion-style";

/** MaiBot persona fields. Chat still sends the three style slots the companion host accepts. */
export const GIRLFRIEND_FIELD_LIMIT = 600;
export const GIRLFRIEND_ALBUM_LIMIT = 8;
export const GIRLFRIEND_LIBRARY_LIMIT = 24;

export type GirlfriendPhoto = { id: string; url: string };
export type GirlfriendPersona = {
  id: string;
  accountId: string;
  nickname: string;
  aliasNames: string[];
  age: number;
  lines: string[];
  personality: string;
  behaviorStyle: string;
  replyStyle: string;
  privateChatPrompts: string;
  cover: string;
  album: GirlfriendPhoto[];
  updatedAt: number;
};

export type GirlfriendDraft = {
  nickname: string;
  aliasNames: string;
  age: string;
  line: string;
  line2: string;
  personality: string;
  behaviorStyle: string;
  replyStyle: string;
  privateChatPrompts: string;
  cover: string;
  album: GirlfriendPhoto[];
};

const MINOR_MARK = /未成年|幼女|小学生|初中生|高中生|女高中生|高一|高二|高三|初一|初二|初三|萝莉|loli/i;
const DATA_JPEG = /^data:image\/jpeg;base64,[a-z0-9+/=\s]+$/i;

export function emptyGirlfriendDraft(): GirlfriendDraft {
  return { nickname: "", aliasNames: "", age: "", line: "", line2: "", personality: "", behaviorStyle: "", replyStyle: "", privateChatPrompts: "", cover: "", album: [] };
}

export function girlfriendDraftFromPersona(person: GirlfriendPersona): GirlfriendDraft {
  return {
    nickname: person.nickname,
    aliasNames: person.aliasNames.filter(name => name !== person.nickname).join("、"),
    age: String(person.age),
    line: person.lines[0] ?? "",
    line2: person.lines[1] ?? "",
    personality: person.personality,
    behaviorStyle: person.behaviorStyle,
    replyStyle: person.replyStyle,
    privateChatPrompts: person.privateChatPrompts,
    cover: person.cover,
    album: person.album,
  };
}

const CN_AGE = /(?<![二三四五六七八九十])((?:二十[一二三四五六七八九]?|十[一二三四五六七八九]?|[零一二三四五六七八九]))\s*岁/g;

function chineseAge(token: string): number | null {
  const digit: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (token === "十") return 10;
  if (token.startsWith("二十")) return token.length === 2 ? 20 : 20 + (digit[token[2]] ?? 0);
  if (token.startsWith("十")) return 10 + (digit[token[1]] ?? 0);
  return token.length === 1 ? digit[token] ?? null : null;
}

function statedUnderage(text: string): boolean {
  if ([...text.matchAll(/(\d{1,2})\s*岁/g)].some(match => Number(match[1]) < 21)) return true;
  return [...text.matchAll(CN_AGE)].some(match => {
    const age = chineseAge(match[1] ?? "");
    return age !== null && age < 21;
  });
}

export function girlfriendIssue(draft: GirlfriendDraft): string {
  const nickname = draft.nickname.trim();
  const age = Number(draft.age.trim());
  const lines = [draft.line, draft.line2].map(line => line.trim()).filter(Boolean);
  const fields = [draft.personality, draft.behaviorStyle, draft.replyStyle, draft.privateChatPrompts];
  const prose = fields.map(field => field.trim()).join("\n");
  if (!draft.cover || !DATA_JPEG.test(draft.cover)) return "请先上传一张封面。";
  if (!nickname || nickname.length > 24) return "名字要写成 1 到 24 个字。";
  if (!Number.isInteger(age) || age < 21 || age > 99) return "年龄要写成 21 到 99。";
  if (lines.length < 1 || lines.length > 2 || lines.some(line => line.length > 80)) return "开场写 1 到 2 句，每句不超过 80 个字。";
  if (fields.some(field => !field.trim())) return "身份、行为、说法、私聊都要写。";
  if (fields.some(field => field.trim().length > GIRLFRIEND_FIELD_LIMIT)) return `人设每一项不能超过 ${GIRLFRIEND_FIELD_LIMIT} 个字。`;
  if (MINOR_MARK.test(prose) || statedUnderage(prose) || statedUnderage(lines.join("\n"))) return "人设里不能写未满 21 岁。";
  const aliases = draft.aliasNames.split(/[、,，]/).map(name => name.trim()).filter(Boolean);
  if (aliases.length > 4 || aliases.some(name => name.length > 24)) return "别名最多 4 个，每个不超过 24 个字。";
  if (draft.album.length > GIRLFRIEND_ALBUM_LIMIT || draft.album.some(photo => !DATA_JPEG.test(photo.url))) return `相册最多 ${GIRLFRIEND_ALBUM_LIMIT} 张图片。`;
  return "";
}

export function girlfriendFromDraft(accountId: string, id: string, draft: GirlfriendDraft, updatedAt = Date.now()): GirlfriendPersona {
  const issue = girlfriendIssue(draft);
  if (issue) throw new Error(issue);
  const nickname = draft.nickname.trim();
  const aliases = draft.aliasNames.split(/[、,，]/).map(name => name.trim()).filter(name => name && name !== nickname);
  return {
    id,
    accountId,
    nickname,
    aliasNames: [nickname, ...aliases].slice(0, 5),
    age: Number(draft.age.trim()),
    lines: [draft.line, draft.line2].map(line => line.trim()).filter(Boolean),
    personality: draft.personality.trim(),
    behaviorStyle: draft.behaviorStyle.trim(),
    replyStyle: draft.replyStyle.trim(),
    privateChatPrompts: draft.privateChatPrompts.trim(),
    cover: draft.cover,
    album: draft.album.slice(0, GIRLFRIEND_ALBUM_LIMIT),
    updatedAt,
  };
}

/** Project MaiBot fields onto the three slots stored with a companion session. */
export function girlfriendChatStyle(person: Pick<GirlfriendPersona, "personality" | "behaviorStyle" | "replyStyle">): CompanionStyle {
  return {
    version: 1,
    personality: person.personality.slice(0, GIRLFRIEND_FIELD_LIMIT),
    speakingStyle: person.replyStyle.slice(0, GIRLFRIEND_FIELD_LIMIT),
    relationshipStyle: person.behaviorStyle.slice(0, GIRLFRIEND_FIELD_LIMIT),
  };
}

export function girlfriendProfile(person: GirlfriendPersona): CompanionProfile {
  return {
    id: person.id,
    name: person.nickname,
    line: person.lines[0] ?? "",
    cover: person.cover,
    situation: person.lines[0] || person.personality,
    introduction: person.personality,
    style: girlfriendChatStyle(person),
  };
}

export async function readGirlfriendImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("请上传 JPG、PNG 或 WebP 图片。");
  if (file.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8 MB。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("这张图片读不出来。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("这张图片读不出来。")), "image/jpeg", 0.8));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } finally {
    bitmap.close();
  }
}

type StoredGirlfriend = GirlfriendPersona & { key: string };

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("xumeng-girlfriends", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("people")) request.result.createObjectStore("people", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("这台设备暂时存不下女友。"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("这台设备暂时读不到女友。"));
  });
}

export async function listGirlfriends(accountId: string): Promise<GirlfriendPersona[]> {
  if (!accountId) return [];
  const db = await database();
  try {
    const rows = await requestToPromise(db.transaction("people").objectStore("people").getAll()) as StoredGirlfriend[];
    return rows
      .filter(row => row.accountId === accountId && !girlfriendIssue(girlfriendDraftFromPersona(row)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    db.close();
  }
}

export async function saveGirlfriend(person: GirlfriendPersona): Promise<void> {
  const issue = girlfriendIssue(girlfriendDraftFromPersona(person));
  if (issue) throw new Error(issue);
  const db = await database();
  try {
    const rows = await requestToPromise(db.transaction("people").objectStore("people").getAll()) as StoredGirlfriend[];
    const mine = rows.filter(row => row.accountId === person.accountId);
    if (!mine.some(row => row.id === person.id) && mine.length >= GIRLFRIEND_LIBRARY_LIMIT) throw new Error("女友已经有 24 位，先删掉一位再新建。");
    await requestToPromise(db.transaction("people", "readwrite").objectStore("people").put({ ...person, key: `${person.accountId}:${person.id}` }));
  } finally {
    db.close();
  }
}

export async function deleteGirlfriend(accountId: string, id: string): Promise<void> {
  const db = await database();
  try {
    await requestToPromise(db.transaction("people", "readwrite").objectStore("people").delete(`${accountId}:${id}`));
  } finally {
    db.close();
  }
}
