import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import { DZMM_CATALOG_CHARACTERS, DZMM_LISTED_CHARACTERS, parsePrivateCharacter, type Character } from "../../../src/lib/dzmm-characters";
import { getDzmmNewConversationBlockReason, selectDzmmDirectory } from "../../../src/lib/dzmm-catalog";
import { pickDzmmCharacterContext } from "../../../src/lib/dzmm-character-context";
import { parseDzmmCharacterAuthoringDraft } from "../../../src/lib/dzmm-character-draft";
import { captureDzmmConversationOpening, parseDzmmConversationOpening, reconcileDzmmConversationOpening, type DzmmConversationOpeningSnapshot } from "../../../src/lib/dzmm-conversation-context";
import { DZMM_INITIAL_STATE, hydrateDzmmState, type DzmmSavedState, type DzmmSavedConversation } from "../../../src/lib/dzmm-storage";
import { matchesDzmmStoryMemory, parseStoryMemory, type DzmmStoryMemory } from "../../../src/lib/dzmm-story-memory";
import { DZMM_WORLD_JOURNAL_LIMIT_CHARS, parseDzmmWorldJournal, pruneDzmmWorldJournal, type DzmmWorldJournal } from "../../../src/lib/dzmm-world-state";
import { ApiError, json, readJson, readOptionalJson } from "./http";
import type { Env, StateEnvelope, UserRecord } from "./types";
import { readPublishedCharacters, readPublishedCharacter } from "./publishing";

const PUBLIC_IDS = new Set(DZMM_CATALOG_CHARACTERS.map((character) => character.id));
const reservedPublicId = (characterId: string) => PUBLIC_IDS.has(characterId) || characterId.startsWith("published-");
const JSON_CHUNK_BYTES = 256 * 1024;
const PREFERENCE_EXTRA_FIELDS = ["bio", "gender", "theme", "homeLayout", "showFloatingChat", "floatingSize",
  "floatingOpacity", "blockedTags", "followedAuthors", "presets", "maxTokens", "worldClockMode", "locale"] as const;
type Row = Record<string, unknown>;
type Delta = { table: "characters" | "conversations" | "messages" | "favorites"; remove: Row[]; upsert: Row[] };

function record(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, `${label}应为 JSON 对象。`);
  return value as Row;
}

function id(value: unknown, label = "ID"): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || value.includes("\0")) {
    throw new ApiError(400, `${label}应为不超过 120 字的非空文本。`);
  }
  return value.trim();
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function preferenceExtras(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const supplied = value as Row;
  return Object.fromEntries(PREFERENCE_EXTRA_FIELDS.flatMap((field) => supplied[field] === undefined ? [] : [[field, supplied[field]]]));
}

function storedStoryMemory(value: unknown, messages: DzmmSavedConversation["messages"]): DzmmStoryMemory | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const memory = parseStoryMemory(JSON.parse(value));
    return matchesDzmmStoryMemory(memory, messages) ? memory : undefined;
  } catch {
    // Optional metadata must never prevent the original conversation from loading.
    return undefined;
  }
}

function storedOpening(value: unknown): DzmmConversationOpeningSnapshot | undefined {
  if (typeof value !== "string") return undefined;
  try { return parseDzmmConversationOpening(JSON.parse(value)); }
  catch { return undefined; }
}

function storedAuthoringDraft(value: unknown): Character["authoringDraft"] {
  if (value === null) return null;
  if (value === undefined) return undefined;
  try { return parseDzmmCharacterAuthoringDraft(value); }
  catch {
    // A damaged optional editor draft must not hide the playable card.
    return undefined;
  }
}

function retainAuthoringDraft(previous: Character | undefined, next: Character, supplied: Row): Character {
  if (!previous?.authoringDraft || supplied.authoringDraft !== undefined) return next;
  if (!same(previous.characterBook, next.characterBook)) {
    throw new ApiError(400, "这个页面没有完整的世界书草稿，不能覆盖它。请刷新后继续编辑，或明确清除未完成草稿。");
  }
  try {
    const retained = parsePrivateCharacter({ ...next, authoringDraft: previous.authoringDraft }, next.id);
    retained.createdAt = next.createdAt;
    return retained;
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "私人角色草稿格式无效。");
  }
}

function storedWorldState(value: unknown, messages: DzmmSavedConversation["messages"]): DzmmWorldJournal | undefined {
  if (typeof value !== "string" || value.length > DZMM_WORLD_JOURNAL_LIMIT_CHARS) return undefined;
  try {
    return pruneDzmmWorldJournal(JSON.parse(value), messages);
  } catch {
    // A damaged optional journal must never hide the original conversation.
    return undefined;
  }
}

/** Older clients may know narrative snapshots but not independently saved pauses.
 * Preserve that timeline only when their mode and supplied checkpoints are safe. */
function retainWorldModeChanges(
  previous: DzmmSavedConversation | undefined, next: DzmmSavedConversation, suppliedWorldState: unknown,
): DzmmWorldJournal | undefined {
  const previousWorld = previous?.worldState;
  if (!previousWorld) return next.worldState;
  const omitsJournal = suppliedWorldState === undefined;
  if (!omitsJournal && (previousWorld.modeChanges === undefined
    || Object.hasOwn(record(suppliedWorldState, "世界状态"), "modeChanges"))) return next.worldState;
  if (previousWorld.modeChanges !== undefined
    && (previous.worldClockMode ?? "story") !== (next.worldClockMode ?? "story")) {
    throw new ApiError(400, "这个页面没有完整的时间模式记录，不能修改时间模式。请刷新后重试，或明确清除世界状态。");
  }
  const retained = pruneDzmmWorldJournal(previousWorld, next.messages);
  if (omitsJournal) return retained;
  const supplied = parseDzmmWorldJournal(suppliedWorldState);
  if (!same(supplied.snapshots, retained?.snapshots ?? [])) {
    throw new ApiError(400, "这个页面没有完整的时间模式记录，不能覆盖剧情快照。请刷新后重试，或明确清除世界状态。");
  }
  try {
    return pruneDzmmWorldJournal(parseDzmmWorldJournal({ ...supplied, modeChanges: retained?.modeChanges ?? [] }), next.messages);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "世界时间模式记录格式无效。");
  }
}

export function normalizeState(value: unknown): DzmmSavedState {
  const supplied = record(value, "state");
  if (supplied.version !== 1 || !Array.isArray(supplied.custom) || !Array.isArray(supplied.conversations)
    || !Array.isArray(supplied.favorites) || !supplied.preferences) {
    throw new ApiError(400, "state 缺少有效的角色、会话、收藏或偏好设置。");
  }
  for (const candidate of supplied.custom) {
    const character = record(candidate, "角色");
    if (reservedPublicId(id(character.id, "角色 ID"))) throw new ApiError(400, "公共角色不可写入私人角色库，请复制为新的角色 ID。");
    if ((character.sourceKind !== undefined && character.sourceKind !== "original")
      || (character.promptOrigin !== undefined && character.promptOrigin !== "original")
      || (character.sourceUrl !== undefined && character.sourceUrl !== "") || character.publication !== undefined) {
      throw new ApiError(400, "私人角色不可冒充公共来源或原站提示词。");
    }
  }
  try {
    const hydrated = hydrateDzmmState(JSON.stringify(supplied));
    if (hydrated.warnings.length) throw new ApiError(400, hydrated.warnings.join(" "));
    return hydrated.state;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "角色或会话格式无效，请检查消息、ID 与偏好设置。");
  }
}

const STATE_READ_QUERIES = [
    "SELECT id,email,nickname,is_guest,version,role,email_verified_at,password_hash FROM users WHERE id=?",
    "SELECT * FROM characters WHERE user_id=? ORDER BY position,id",
    "SELECT * FROM conversations WHERE user_id=? ORDER BY position,id",
    "SELECT * FROM messages WHERE user_id=? ORDER BY conversation_id,position,id",
    "SELECT character_id FROM favorites WHERE user_id=? ORDER BY position,character_id",
    "SELECT nickname,persona,preset,model,dark,extra_json FROM preferences WHERE user_id=?",
  ];

function stateReadStatements(db: D1Database, userId: string): D1PreparedStatement[] {
  return STATE_READ_QUERIES.map(query => db.prepare(query).bind(userId));
}

/** A batch gives the user revision and all normalized entities one consistent read snapshot. */
export async function readState(db: D1Database, user: UserRecord): Promise<StateEnvelope> {
  return stateEnvelope(await db.batch<Row>(stateReadStatements(db, user.id)));
}

/** Both GETs and write acknowledgements use the same unchanged hydration rules. */
function stateEnvelope(results: D1Result<Row>[]): StateEnvelope {
  const account = results[0].results[0];
  if (!account) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const custom: Character[] = results[1].results.map((row) => {
    const context = JSON.parse(row.context_json as string || "{}") as Row;
    const authoringDraft = storedAuthoringDraft(context.authoringDraft);
    return {
      id: row.id as string, name: row.name as string, author: row.author as string, cover: row.cover as string,
      tags: JSON.parse(row.tags_json as string), description: row.description as string,
      personality: row.personality as string, scenario: row.scenario as string, firstMessage: row.first_message as string,
      createdAt: row.created_at as string, heat: "0", likes: "0", sourceUrl: "", sourceKind: "original", promptOrigin: "original",
      ...pickDzmmCharacterContext(context),
      ...(authoringDraft === undefined ? {} : { authoringDraft }),
    };
  });
  const messageGroups = new Map<string, DzmmSavedConversation["messages"]>();
  for (const row of results[3].results) {
    const key = row.conversation_id as string;
    const messages = messageGroups.get(key) ?? [];
    messages.push({ id: row.id as string, role: row.role as "user" | "assistant", content: row.content as string });
    messageGroups.set(key, messages);
  }
  const conversations: DzmmSavedConversation[] = results[2].results.map((row) => {
    const messages = messageGroups.get(row.id as string) ?? [];
    const storyMemory = storedStoryMemory(row.story_memory_json, messages);
    const worldState = storedWorldState(row.world_state_json, messages);
    const opening = storedOpening(row.opening_json);
    return {
      id: row.id as string, characterId: row.character_id as string, title: row.title as string,
      updatedAt: row.updated_at as number, messages,
      ...(opening ? { opening } : {}),
      ...(storyMemory ? { storyMemory } : {}),
      ...(worldState ? { worldState } : {}),
      ...(row.world_clock_mode === "story" || row.world_clock_mode === "realtime" ? { worldClockMode: row.world_clock_mode } : {}),
    };
  });
  const preference = results[5].results[0];
  const preferences = preference ? {
    ...preferenceExtras(JSON.parse(preference.extra_json as string)),
    nickname: preference.nickname, persona: preference.persona, preset: preference.preset,
    model: preference.model, dark: Boolean(preference.dark),
  } : { ...DZMM_INITIAL_STATE.preferences, nickname: account.nickname };
  const { state } = hydrateDzmmState(JSON.stringify({
    version: 1, custom, conversations, favorites: results[4].results.map((row) => row.character_id), preferences,
  }));
  const version = account.version as number;
  return {
    state, version, initialized: version > 0,
    user: { id: account.id as string, email: account.email as string | null, nickname: account.nickname as string,
      isGuest: Boolean(account.is_guest), role: account.role === "super" ? "super" : "user",
      emailVerified: !account.is_guest && account.email_verified_at != null,
      hasPassword: !account.is_guest && Boolean(account.password_hash),
      passwordSetupRequired: !account.is_guest && account.email_verified_at != null && !account.password_hash },
  };
}

function characterRow(character: Character, position: number): Row {
  return { id: character.id, name: character.name, author: character.author, cover: character.cover,
    tags_json: JSON.stringify(character.tags), description: character.description, personality: character.personality,
    scenario: character.scenario, first_message: character.firstMessage, created_at: character.createdAt, position,
    context_json: JSON.stringify({ ...pickDzmmCharacterContext(character as unknown as Row),
      ...(character.authoringDraft === undefined ? {} : { authoringDraft: character.authoringDraft }) }) };
}

function conversationRow(conversation: DzmmSavedConversation, position: number): Row {
  return { id: conversation.id, character_id: conversation.characterId, title: conversation.title, updated_at: conversation.updatedAt, position,
    story_memory_json: conversation.storyMemory === undefined ? null : JSON.stringify(conversation.storyMemory),
    world_state_json: conversation.worldState === undefined ? null : JSON.stringify(conversation.worldState),
    world_clock_mode: conversation.worldClockMode ?? null,
    opening_json: conversation.opening === undefined ? null : JSON.stringify(conversation.opening) };
}

function entityDelta(table: Delta["table"], previous: Row[], next: Row[], key: (row: Row) => string): Delta {
  const old = new Map(previous.map((row) => [key(row), row]));
  const incoming = new Map(next.map((row) => [key(row), row]));
  return { table,
    remove: previous.filter((row) => !incoming.has(key(row))),
    upsert: next.filter((row) => !same(old.get(key(row)), row)),
  };
}

/** Entity deltas preserve unchanged history rather than deleting and rebuilding each conversation. */
export function stateDelta(previous: DzmmSavedState, next: DzmmSavedState): Delta[] {
  const messageRows = (state: DzmmSavedState) => state.conversations.flatMap((conversation) => conversation.messages.map((message, position) => ({
    conversation_id: conversation.id, id: message.id, role: message.role, content: message.content, position,
  })));
  const deletedConversations = new Set(previous.conversations.filter((conversation) => !next.conversations.some((item) => item.id === conversation.id)).map((conversation) => conversation.id));
  const messages = entityDelta("messages", messageRows(previous).filter((row) => !deletedConversations.has(row.conversation_id as string)), messageRows(next), (row) => JSON.stringify([row.conversation_id, row.id]));
  return [
    entityDelta("characters", previous.custom.map(characterRow), next.custom.map(characterRow), (row) => row.id as string),
    entityDelta("conversations", previous.conversations.map(conversationRow), next.conversations.map(conversationRow), (row) => row.id as string),
    messages,
    entityDelta("favorites", previous.favorites.map((character_id, position) => ({ character_id, position })), next.favorites.map((character_id, position) => ({ character_id, position })), (row) => row.character_id as string),
  ];
}

function jsonChunks(rows: Row[]): string[] {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let chunk: Row[] = [];
  let bytes = 2;
  for (const row of rows) {
    const rowBytes = encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (chunk.length && bytes + rowBytes > JSON_CHUNK_BYTES) { chunks.push(JSON.stringify(chunk)); chunk = []; bytes = 2; }
    chunk.push(row); bytes += rowBytes;
  }
  if (chunk.length) chunks.push(JSON.stringify(chunk));
  return chunks;
}

const TABLE_COLUMNS = {
  characters: ["id", "name", "author", "cover", "tags_json", "description", "personality", "scenario", "first_message", "created_at", "position", "context_json"],
  conversations: ["id", "character_id", "title", "updated_at", "position", "story_memory_json", "world_state_json", "world_clock_mode", "opening_json"],
  messages: ["conversation_id", "id", "role", "content", "position"],
  favorites: ["character_id", "position"],
} as const;

function upsertStatement(db: D1Database, table: Delta["table"], rows: string, userId: string, nonce: string): D1PreparedStatement {
  const columns = TABLE_COLUMNS[table];
  const keys = table === "favorites" ? ["user_id", "character_id"] : table === "messages" ? ["user_id", "conversation_id", "id"] : ["user_id", "id"];
  const update = columns.filter((column) => !keys.includes(column)).map((column) => `${column}=excluded.${column}`).join(",");
  return db.prepare(`INSERT INTO ${table}(user_id,${columns.join(",")})
    SELECT ?1,${columns.map((column) => `json_extract(value,'$.${column}')`).join(",")} FROM json_each(?2)
    WHERE EXISTS(SELECT 1 FROM users WHERE id=?1 AND mutation_token=?3)
    ON CONFLICT(${keys.join(",")}) DO UPDATE SET ${update}`).bind(userId, rows, nonce);
}

function deleteStatement(db: D1Database, table: Delta["table"], rows: string, userId: string, nonce: string): D1PreparedStatement {
  const match = table === "messages" ? "json_extract(value,'$.conversation_id')=messages.conversation_id AND json_extract(value,'$.id')=messages.id"
    : table === "favorites" ? "json_extract(value,'$.character_id')=favorites.character_id" : `json_extract(value,'$.id')=${table}.id`;
  return db.prepare(`DELETE FROM ${table} WHERE user_id=?1
    AND EXISTS(SELECT 1 FROM json_each(?2) WHERE ${match})
    AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND mutation_token=?3)`).bind(userId, rows, nonce);
}

function conflict(envelope: StateEnvelope): ApiError {
  return new ApiError(409, "记录已在其他页面更新，请加载最新记录后重试。", envelope as unknown as Record<string, unknown>);
}

export async function writeState(db: D1Database, user: UserRecord, before: StateEnvelope, next: DzmmSavedState, expectedVersion: number): Promise<StateEnvelope> {
  if (before.version !== expectedVersion) throw conflict(before);
  const deltas = stateDelta(before.state, next);
  const preferencesChanged = !same(before.state.preferences, next.preferences);
  const count = deltas.reduce((total, delta) => total + delta.remove.length + delta.upsert.length, preferencesChanged ? 1 : 0);
  if (count === 0 && before.initialized) return before;
  const nonce = crypto.randomUUID();
  const statements = [db.prepare("UPDATE users SET version=version+1,mutation_token=?,nickname=? WHERE id=? AND version=?")
    .bind(nonce, next.preferences.nickname, user.id, expectedVersion)];
  // Conversations are deleted first so their message rows disappear by FK cascade.
  for (const table of ["conversations", "messages", "favorites", "characters"] as const) {
    const delta = deltas.find((item) => item.table === table)!;
    for (const rows of jsonChunks(delta.remove.map((row) => table === "messages" ? { conversation_id: row.conversation_id, id: row.id }
      : table === "favorites" ? { character_id: row.character_id } : { id: row.id }))) statements.push(deleteStatement(db, table, rows, user.id, nonce));
  }
  for (const delta of deltas) for (const rows of jsonChunks(delta.upsert)) statements.push(upsertStatement(db, delta.table, rows, user.id, nonce));
  if (preferencesChanged) {
    const preference = next.preferences;
    statements.push(db.prepare(`INSERT INTO preferences(user_id,nickname,persona,preset,model,dark,extra_json)
      SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM users WHERE id=?1 AND mutation_token=?8)
      ON CONFLICT(user_id) DO UPDATE SET nickname=excluded.nickname,persona=excluded.persona,preset=excluded.preset,model=excluded.model,dark=excluded.dark,extra_json=excluded.extra_json`)
      .bind(user.id, preference.nickname, preference.persona, preference.preset, preference.model, Number(preference.dark),
        JSON.stringify(preferenceExtras(preference)), nonce));
  }
  // Acknowledgement must describe this CAS/delta commit, not another tab
  // that writes before a later independent read can run. Failed CAS replies
  // also retain the current state from this same transaction snapshot.
  const readOffset = statements.length;
  statements.push(...stateReadStatements(db, user.id));
  const result = await db.batch<Row>(statements);
  const envelope = stateEnvelope(result.slice(readOffset));
  if (result[0].meta.changes !== 1) throw conflict(envelope);
  return envelope;
}

function expectedVersion(request: Request, body: Row, current: number, required = false): number {
  const header = request.headers.get("If-Match");
  let fromHeader: number | undefined;
  if (header !== null) {
    const match = /^"?(\d+)"?$/.exec(header);
    if (!match) throw new ApiError(400, "If-Match 应为有效的记录版本。");
    fromHeader = Number(match[1]);
  }
  const version = body.version ?? fromHeader;
  if (required && version === undefined) throw new ApiError(400, "同步请求必须提供 version。");
  if (version !== undefined && (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER)) {
    throw new ApiError(400, "version 应为非负安全整数。");
  }
  if (body.version !== undefined && fromHeader !== undefined && body.version !== fromHeader) throw new ApiError(400, "请求版本与 If-Match 不一致。");
  return version as number | undefined ?? current;
}

function checkAccountId(body: Row, user: UserRecord, required: boolean): void {
  if (!required && body.accountId === undefined) return;
  if (typeof body.accountId !== "string" || body.accountId.length > 120
    || !body.accountId || body.accountId.includes("\0") || body.accountId !== user.id) {
    throw new ApiError(401, "当前账户已切换，请重新加载当前账户记录后再同步。");
  }
}

function heat(value: string) { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed * (value.includes("万") ? 10000 : 1) : 0; }
function ownedCharacter(state: DzmmSavedState, characterId: string): Character {
  const character = state.custom.find((item) => item.id === characterId);
  if (!character) throw new ApiError(404, "私人角色不存在或不属于当前账户。");
  return character;
}
function ownedConversation(state: DzmmSavedState, conversationId: string): DzmmSavedConversation {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new ApiError(404, "会话不存在或不属于当前账户。");
  return conversation;
}
async function knownCharacter(env: Env, state: DzmmSavedState, characterId: string): Promise<Character> {
  const character = [...state.custom, ...DZMM_CATALOG_CHARACTERS].find((item) => item.id === characterId)
    ?? (characterId.startsWith("published-") ? await readPublishedCharacter(env, characterId) : null);
  if (!character) throw new ApiError(404, "角色不存在或不属于当前账户。");
  return character;
}

export async function handleApi(request: Request, env: Env, user: UserRecord): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (!path.startsWith("/v1/")) throw new ApiError(404, "接口不存在。");
  const before = await readState(env.DB, user);
  if (path === "/v1/state" && request.method === "GET") return json(before);
  if (path === "/v1/characters" && request.method === "GET") {
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const tag = (url.searchParams.get("tag") ?? "").trim();
    const sort = url.searchParams.get("sort") ?? "hot";
    if (query.length > 200 || tag.length > 40 || (sort !== "hot" && sort !== "new")) throw new ApiError(400, "角色筛选条件无效。");
    const published = await readPublishedCharacters(env);
    const sources = await env.DB.prepare("SELECT private_character_id FROM character_publications WHERE is_listed=1 AND user_id=?").bind(user.id).all<{ private_character_id: string }>();
    const suppressedPrivateIds = sources.results.map((row) => row.private_character_id);
    const characters = selectDzmmDirectory(before.state.custom, [...DZMM_LISTED_CHARACTERS, ...published], new Set(suppressedPrivateIds)).filter((character) => (!tag || character.tags.includes(tag))
      && (!query || `${character.name} ${character.introduction ?? ""} ${character.description} ${character.author} ${character.tags.join(" ")}`.toLowerCase().includes(query)));
    characters.sort(sort === "new" ? (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) : (a, b) => heat(b.heat) - heat(a.heat));
    return json({ characters, suppressedPrivateIds });
  }
  if (path === "/v1/conversations" && request.method === "GET") return json({ conversations: before.state.conversations });
  let resourceId: string | undefined;
  const route = /^\/v1\/(characters|conversations|favorites)(?:\/([^/]+))?(\/messages)?$/.exec(path);
  if (route?.[2]) {
    try { resourceId = id(decodeURIComponent(route[2])); } catch { throw new ApiError(400, "资源 ID 无效。"); }
  }
  if (route?.[1] === "conversations" && resourceId && !route[3] && request.method === "GET") {
    return json({ conversation: ownedConversation(before.state, resourceId) });
  }
  const optionalBody = request.method === "DELETE" || (route?.[1] === "favorites" && request.method === "PUT");
  const body = optionalBody ? await readOptionalJson(request) : request.body ? await readJson(request) : {};
  checkAccountId(body, user, path === "/v1/state" && request.method === "PUT");
  const expected = expectedVersion(request, body, before.version, path === "/v1/state");
  if (path === "/v1/state" && request.method === "PUT") {
    const normalized = normalizeState(body.state);
    const previousConversations = new Map(before.state.conversations.map(conversation => [conversation.id, conversation]));
    const suppliedState = record(body.state, "state");
    const previousCharacters = new Map(before.state.custom.map(character => [character.id, character]));
    const suppliedCharacters = new Map((suppliedState.custom as Row[]).map(character => [id(character.id, "角色 ID"), character]));
    normalized.custom = normalized.custom.map(character => retainAuthoringDraft(previousCharacters.get(character.id), character, suppliedCharacters.get(character.id)!));
    const suppliedConversations = new Map(normalized.conversations.map((conversation, index) => [conversation.id, (suppliedState.conversations as Row[])[index]]));
    for (const conversation of normalized.conversations) {
      const previous = previousConversations.get(conversation.id);
      const supplied = suppliedConversations.get(conversation.id);
      if (previous?.worldClockMode && supplied?.worldClockMode === undefined) conversation.worldClockMode = previous.worldClockMode;
      if (previous && previous.characterId !== conversation.characterId) {
        delete conversation.storyMemory;
        delete conversation.worldState;
        delete conversation.opening;
      } else {
        const retained = retainWorldModeChanges(previous, conversation, supplied?.worldState);
        if (retained) conversation.worldState = retained;
        else delete conversation.worldState;
      }
      if (previous?.characterId === conversation.characterId && previous.opening && supplied?.opening === undefined) {
        conversation.opening = previous.opening;
      }
      if (conversation.opening) conversation.opening = reconcileDzmmConversationOpening(conversation.opening, conversation.messages);
    }
    if (before.state.preferences.worldClockMode && record(suppliedState.preferences, "偏好设置").worldClockMode === undefined) {
      normalized.preferences.worldClockMode = before.state.preferences.worldClockMode;
    }
    return json(await writeState(env.DB, user, before, normalized, expected));
  }
  const next = structuredClone(before.state);
  if (path === "/v1/preferences" && request.method === "PATCH") {
    next.preferences = { ...next.preferences, ...record(body.preferences, "偏好设置") };
  } else if (route?.[1] === "characters" && !route[3]) {
    if (request.method === "POST") {
      const supplied = record(body.character, "角色");
      const characterId = resourceId ?? (supplied.id === undefined ? `local-${crypto.randomUUID()}` : id(supplied.id, "角色 ID"));
      if (supplied.id !== undefined && id(supplied.id) !== characterId) throw new ApiError(400, "路径与角色 ID 不一致。");
      if (reservedPublicId(characterId)) throw new ApiError(400, "公共角色不可修改，请复制为新的角色 ID。");
      if (next.custom.some((item) => item.id === characterId)) throw new ApiError(409, "角色 ID 已存在。");
      next.custom.unshift({ ...supplied, id: characterId, createdAt: supplied.createdAt ?? new Date().toISOString() } as Character);
    } else if (resourceId && request.method === "PATCH") {
      const previous = ownedCharacter(next, resourceId);
      const supplied = record(body.character, "角色");
      if (supplied.id !== undefined && supplied.id !== resourceId) throw new ApiError(400, "不可修改角色 ID。");
      if (previous.authoringDraft && supplied.authoringDraft === undefined && supplied.characterBook !== undefined) {
        let characterBook: Character["characterBook"];
        try { characterBook = pickDzmmCharacterContext({ characterBook: supplied.characterBook }).characterBook; }
        catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "世界书格式无效。"); }
        if (!same(previous.characterBook, characterBook)) {
          throw new ApiError(400, "这个页面没有完整的世界书草稿，不能覆盖它。请刷新后继续编辑，或明确清除未完成草稿。");
        }
      }
      Object.assign(previous, supplied, { id: resourceId });
    } else if (resourceId && request.method === "DELETE") {
      ownedCharacter(next, resourceId);
      next.custom = next.custom.filter((character) => character.id !== resourceId);
      next.conversations = next.conversations.filter((conversation) => conversation.characterId !== resourceId);
      next.favorites = next.favorites.filter((characterId) => characterId !== resourceId);
    } else throw new ApiError(405, "该角色接口不支持当前方法。");
  } else if (route?.[1] === "conversations") {
    if (route[3] && resourceId && request.method === "PUT") {
      const conversation = ownedConversation(next, resourceId);
      if (!Array.isArray(body.messages)) throw new ApiError(400, "messages 应为消息列表。");
      conversation.messages = body.messages.map((message) => {
        const supplied = record(message, "消息");
        return { ...supplied, id: supplied.id ?? crypto.randomUUID() } as DzmmSavedConversation["messages"][number];
      });
      if (conversation.opening) conversation.opening = reconcileDzmmConversationOpening(conversation.opening, conversation.messages);
      if (conversation.storyMemory && !matchesDzmmStoryMemory(conversation.storyMemory, conversation.messages)) delete conversation.storyMemory;
      const retainedWorldState = pruneDzmmWorldJournal(conversation.worldState, conversation.messages);
      if (retainedWorldState) conversation.worldState = retainedWorldState;
      else delete conversation.worldState;
      conversation.updatedAt = Date.now();
    } else if (!route[3] && request.method === "POST") {
      const supplied = record(body.conversation, "会话");
      const conversationId = resourceId ?? (supplied.id === undefined ? crypto.randomUUID() : id(supplied.id, "会话 ID"));
      if (supplied.id !== undefined && id(supplied.id) !== conversationId) throw new ApiError(400, "路径与会话 ID 不一致。");
      if (next.conversations.some((item) => item.id === conversationId)) throw new ApiError(409, "会话 ID 已存在。");
      const character = await knownCharacter(env, next, id(supplied.characterId, "角色 ID"));
      const blocked = getDzmmNewConversationBlockReason(character);
      if (blocked) throw new ApiError(404, blocked);
      const restoreOpening = supplied.messages === undefined || (Array.isArray(supplied.messages) && !supplied.messages.length);
      let openingSnapshot: DzmmConversationOpeningSnapshot | undefined;
      if (restoreOpening) {
        try {
          openingSnapshot = supplied.opening === undefined ? captureDzmmConversationOpening(character) : parseDzmmConversationOpening(supplied.opening);
        } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "会话开场格式无效。"); }
      }
      const opening = openingSnapshot ? openingSnapshot.messages.map(message => ({ ...message, id: crypto.randomUUID() })) : supplied.messages;
      next.conversations.unshift({ ...supplied, id: conversationId, characterId: character.id,
        title: supplied.title ?? character.name, updatedAt: supplied.updatedAt ?? Date.now(), messages: opening,
        ...(openingSnapshot ? { opening: openingSnapshot } : {}) } as DzmmSavedConversation);
    } else if (!route[3] && resourceId && request.method === "PATCH") {
      const conversation = ownedConversation(next, resourceId);
      const supplied = record(body.conversation, "会话");
      if (Object.keys(supplied).some((key) => !["title", "characterId", "updatedAt", "storyMemory", "worldState", "worldClockMode", "opening"].includes(key))) throw new ApiError(400, "会话仅支持修改标题、角色、更新时间、开场、剧情记忆与世界状态设置。");
      const nextCharacter = supplied.characterId === undefined ? undefined
        : await knownCharacter(env, next, id(supplied.characterId, "角色 ID"));
      const changedCharacter = Boolean(nextCharacter && nextCharacter.id !== conversation.characterId);
      if (nextCharacter && changedCharacter) {
        const blocked = getDzmmNewConversationBlockReason(nextCharacter);
        if (blocked) throw new ApiError(404, blocked);
      }
      const { storyMemory, worldState, opening, ...changes } = supplied;
      if (nextCharacter) changes.characterId = nextCharacter.id;
      if (opening === null) delete conversation.opening;
      else if (opening !== undefined) {
        try { conversation.opening = parseDzmmConversationOpening(opening); }
        catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "会话开场格式无效。"); }
      }
      if (storyMemory === null) delete conversation.storyMemory;
      else if (storyMemory !== undefined) {
        try {
          const memory = parseStoryMemory(storyMemory);
          if (!matchesDzmmStoryMemory(memory, conversation.messages)) throw new Error("剧情记忆与当前消息不一致。");
          conversation.storyMemory = memory;
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : "剧情记忆格式无效。");
        }
      }
      if (worldState === null) delete conversation.worldState;
      else if (worldState !== undefined) {
        try {
          const journal = parseDzmmWorldJournal(worldState);
          const retained = pruneDzmmWorldJournal(journal, conversation.messages);
          if (journal.snapshots.length !== (retained?.snapshots.length ?? 0)) throw new Error("世界状态与当前消息不一致。");
          if (retained) conversation.worldState = retained;
          else delete conversation.worldState;
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : "世界状态格式无效。");
        }
      }
      Object.assign(conversation, changes);
      if (!changedCharacter && worldState !== null) {
        const retained = retainWorldModeChanges(ownedConversation(before.state, resourceId), conversation, worldState);
        if (retained) conversation.worldState = retained;
        else delete conversation.worldState;
      }
      if (supplied.characterId !== undefined) delete conversation.storyMemory;
      if (changedCharacter) { delete conversation.worldState; delete conversation.opening; }
    } else if (!route[3] && resourceId && request.method === "DELETE") {
      ownedConversation(next, resourceId);
      next.conversations = next.conversations.filter((conversation) => conversation.id !== resourceId);
    } else throw new ApiError(405, "该会话接口不支持当前方法。");
  } else if (route?.[1] === "favorites" && resourceId && !route[3]) {
    await knownCharacter(env, next, resourceId);
    if (request.method === "PUT") { if (!next.favorites.includes(resourceId)) next.favorites.push(resourceId); }
    else if (request.method === "DELETE") next.favorites = next.favorites.filter((characterId) => characterId !== resourceId);
    else throw new ApiError(405, "收藏接口仅支持 PUT 或 DELETE。");
  } else throw new ApiError(404, "接口不存在。");
  return json(await writeState(env.DB, user, before, normalizeState(next), expected));
}
