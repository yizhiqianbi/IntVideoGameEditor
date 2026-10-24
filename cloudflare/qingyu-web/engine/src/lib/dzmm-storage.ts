import { DZMM_DEFAULT_MODEL, isDzmmModelPreset, type DzmmModelPreset } from "./dzmm-models";
import {
  DZMM_CATALOG_CHARACTERS,
  parseCharacterImport,
  parsePrivateCharacter,
  type Character,
} from "./dzmm-characters";
import { matchesDzmmStoryMemory, parseStoryMemory, type DzmmStoryMemory } from "./dzmm-story-memory";
import { parseDzmmWorldJournal, pruneDzmmWorldJournal, type DzmmWorldJournal } from "./dzmm-world-state";
import { parseDzmmConversationOpening, type DzmmConversationOpeningSnapshot } from "./dzmm-conversation-context";
import { isXumengLocale, type XumengLocale } from "./xumeng-i18n";

export type DzmmSavedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type DzmmSavedConversation = {
  id: string;
  characterId: string;
  title: string;
  messages: DzmmSavedMessage[];
  updatedAt: number;
  /** New stories begin as an adventure; finishing it keeps the same history in chat. */
  phase?: "adventure" | "chat";
  opening?: DzmmConversationOpeningSnapshot;
  storyMemory?: DzmmStoryMemory;
  worldState?: DzmmWorldJournal;
  worldClockMode?: "story" | "realtime";
};

export type DzmmPreferences = {
  nickname: string;
  persona: string;
  preset: string;
  model: DzmmModelPreset;
  dark: boolean;
  bio?: string;
  gender?: "male" | "female" | "other";
  theme?: "light" | "dark" | "system";
  homeLayout?: "single" | "double";
  showFloatingChat?: boolean;
  floatingSize?: "small" | "medium" | "large";
  floatingOpacity?: number;
  blockedTags?: string[];
  followedAuthors?: string[];
  presets?: DzmmSavedPreset[];
  maxTokens?: number;
  worldClockMode?: "story" | "realtime";
  /** UI and model response language. Omitted in legacy records, defaults to Simplified Chinese. */
  locale?: XumengLocale;
};

export type DzmmSavedPreset = { id: string; name: string; content: string };

export type DzmmSavedState = {
  version: 1;
  favorites: string[];
  custom: Character[];
  conversations: DzmmSavedConversation[];
  preferences: DzmmPreferences;
};

const LEGACY_NEUTRAL_PRESET = "保持角色性格。用动作、环境和自然对话推进故事，不替用户决定行动。";
export const DZMM_DEFAULT_PRESET = "保持人物性格，以尊重、信任、日常与冒险推进关系。内容适合全年龄，不替用户决定行动。";

export const DZMM_INITIAL_STATE: DzmmSavedState = {
  version: 1,
  favorites: [],
  custom: [],
  conversations: [],
  preferences: {
    nickname: "游客",
    persona: "",
    preset: DZMM_DEFAULT_PRESET,
    model: DZMM_DEFAULT_MODEL,
    dark: true,
  },
};

const FALLBACK_CREATED_AT = "1970-01-01T00:00:00.000Z";
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(
  value: unknown,
  maxLength: number,
  required = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    !value.includes("\0") &&
    (!required || Boolean(value.trim()))
  );
}

function readId(value: unknown): string | undefined {
  return isText(value, 120, true) ? value.trim() : undefined;
}

/** Published cards are fetched separately; their references must survive local/offline hydration. */
export function isDzmmPublishedCharacterId(value: string): boolean {
  return /^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}

function readArray(
  record: Record<string, unknown>,
  key: string,
  warnings: string[],
): unknown[] {
  if (record[key] === undefined) return [];
  if (Array.isArray(record[key])) return record[key];
  warnings.push(`本地记录的 ${key} 格式无效，已使用空列表。`);
  return [];
}

function reservedIds(records: unknown[]): Set<string> {
  return new Set(
    records.flatMap((record) => {
      const id = isRecord(record) ? readId(record.id) : undefined;
      return id ? [id] : [];
    }),
  );
}

function recordId(
  value: unknown,
  fallback: string,
  reserved: Set<string>,
  used: Set<string>,
): string {
  let id = readId(value);
  if (value !== undefined && !id) throw new Error("记录 ID 无效。");
  if (!id) {
    id = fallback;
    let suffix = 1;
    while (reserved.has(id) || used.has(id)) id = `${fallback}-${suffix++}`;
  }
  if (used.has(id)) throw new Error("记录 ID 重复。");
  used.add(id);
  return id;
}

function hydratePreferences(
  value: unknown,
  warnings: string[],
): DzmmPreferences {
  const preferences = { ...DZMM_INITIAL_STATE.preferences };
  if (value === undefined) return preferences;
  if (!isRecord(value)) {
    warnings.push("本地偏好设置格式无效，已恢复默认设置。");
    return preferences;
  }
  for (const [field, maxLength] of [
    ["nickname", 30],
    ["persona", 4_000],
    ["preset", 8_000],
  ] as const) {
    if (value[field] === undefined) continue;
    if (isText(value[field], maxLength, field === "nickname")) {
      preferences[field] = field === "preset" && value[field] === LEGACY_NEUTRAL_PRESET
        ? DZMM_DEFAULT_PRESET : value[field];
    } else {
      warnings.push(`本地偏好设置的 ${field} 无效，已恢复默认值。`);
    }
  }
  if (value.model !== undefined) {
    if (isDzmmModelPreset(value.model)) {
      preferences.model = value.model;
    } else {
      warnings.push("本地模型模式无效，已使用均衡模式。");
    }
  }
  if (value.dark !== undefined) {
    if (typeof value.dark === "boolean") preferences.dark = value.dark;
    else warnings.push("本地主题设置无效，已使用默认深色主题。");
  }
  const invalid = (field: string) => warnings.push(`本地偏好设置的 ${field} 无效，已忽略该设置。`);
  const suppliedPreferences = value;
  if (value.bio !== undefined) {
    if (isText(value.bio, 500)) preferences.bio = value.bio;
    else invalid("bio");
  }
  function enumeration<T extends string>(field: string, choices: readonly T[]): T | undefined {
    if (suppliedPreferences[field] === undefined) return undefined;
    if (typeof suppliedPreferences[field] === "string" && choices.includes(suppliedPreferences[field] as T)) return suppliedPreferences[field] as T;
    invalid(field);
    return undefined;
  }
  const gender = enumeration("gender", ["male", "female", "other"] as const);
  const theme = enumeration("theme", ["light", "dark", "system"] as const);
  const homeLayout = enumeration("homeLayout", ["single", "double"] as const);
  const floatingSize = enumeration("floatingSize", ["small", "medium", "large"] as const);
  const worldClockMode = enumeration("worldClockMode", ["story", "realtime"] as const);
  if (gender !== undefined) preferences.gender = gender;
  if (theme !== undefined) preferences.theme = theme;
  if (homeLayout !== undefined) preferences.homeLayout = homeLayout;
  if (floatingSize !== undefined) preferences.floatingSize = floatingSize;
  if (worldClockMode !== undefined) preferences.worldClockMode = worldClockMode;
  if (value.locale !== undefined) {
    if (isXumengLocale(value.locale)) preferences.locale = value.locale;
    else invalid("locale");
  }
  if (value.showFloatingChat !== undefined) {
    if (typeof value.showFloatingChat === "boolean") preferences.showFloatingChat = value.showFloatingChat;
    else invalid("showFloatingChat");
  }
  if (value.floatingOpacity !== undefined) {
    if (typeof value.floatingOpacity === "number" && Number.isFinite(value.floatingOpacity)
      && value.floatingOpacity >= 20 && value.floatingOpacity <= 100) preferences.floatingOpacity = value.floatingOpacity;
    else invalid("floatingOpacity");
  }
  if (value.maxTokens !== undefined) {
    if (typeof value.maxTokens === "number" && Number.isInteger(value.maxTokens)
      && value.maxTokens >= 128 && value.maxTokens <= 4096) preferences.maxTokens = value.maxTokens;
    else invalid("maxTokens");
  }
  for (const [field, maximum, textLimit] of [["blockedTags", 50, 40], ["followedAuthors", 200, 120]] as const) {
    const supplied = value[field];
    if (supplied === undefined) continue;
    if (!Array.isArray(supplied) || supplied.length > maximum) { invalid(field); continue; }
    const accepted = new Set<string>();
    for (const item of supplied) {
      if (!isText(item, textLimit, true) || accepted.has(item.trim())) { invalid(field); continue; }
      accepted.add(item.trim());
    }
    preferences[field] = [...accepted];
  }
  if (value.presets !== undefined) {
    if (!Array.isArray(value.presets) || value.presets.length > 30) invalid("presets");
    else {
      const accepted: DzmmSavedPreset[] = [];
      const ids = new Set<string>();
      for (const preset of value.presets) {
        if (!isRecord(preset)) { invalid("presets"); continue; }
        const id = readId(preset.id);
        if (!id || ids.has(id) || !isText(preset.name, 80, true) || !isText(preset.content, 8_000)) {
          invalid("presets");
          continue;
        }
        ids.add(id);
        accepted.push({ id, name: preset.name, content: preset.content });
      }
      preferences.presets = accepted;
    }
  }
  return preferences;
}

function hydrateMessages(
  value: unknown,
  conversationIndex: number,
): DzmmSavedMessage[] {
  if (!Array.isArray(value)) throw new Error("聊天消息不是列表。");
  const reserved = reservedIds(value);
  const used = new Set<string>();
  return value.map((message: unknown, messageIndex: number) => {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant") ||
      !isText(message.content, 12_000, true)
    ) {
      throw new Error("聊天消息格式无效。");
    }
    return {
      id: recordId(
        message.id,
        `saved-message-${conversationIndex}-${messageIndex}`,
        reserved,
        used,
      ),
      role: message.role,
      content: message.content,
    };
  });
}

/** Validate each saved record independently; malformed JSON remains the caller's responsibility. */
export function hydrateDzmmState(raw: string): {
  state: DzmmSavedState;
  warnings: string[];
} {
  const saved: unknown = JSON.parse(raw);
  if (!isRecord(saved) || saved.version !== 1) {
    throw new Error("本地记录格式或版本无效。");
  }
  const warnings: string[] = [];
  const custom: Character[] = [];
  const knownCharacters = new Map(
    DZMM_CATALOG_CHARACTERS.map((character) => [character.id, character]),
  );
  const customRecords = readArray(saved, "custom", warnings);
  const reservedCustomIds = reservedIds(customRecords);
  const usedCharacterIds = new Set(knownCharacters.keys());
  customRecords.forEach((record, index) => {
    try {
      if (!isRecord(record)) throw new Error("角色卡格式无效。");
      // Reserve an ID only after the card is valid, so a broken duplicate cannot hide a good card.
      const candidateIds = new Set(usedCharacterIds);
      const id = recordId(
        record.id,
        `saved-character-${index}`,
        reservedCustomIds,
        candidateIds,
      );
      if (id.startsWith("published-")) throw new Error("公开角色 ID 不可用于私人角色。");
      let character = parseCharacterImport(record, id);
      if (record.authoringDraft !== undefined) {
        try { character = parsePrivateCharacter(record, id); }
        catch { warnings.push(`第 ${index + 1} 个角色的私人创作草稿无效，已保留角色并忽略无效草稿。`); }
      }
      const fields = Object.values(character);
      if (
        fields.some(
          (field) => typeof field === "string" && field.includes("\0"),
        ) ||
        character.tags.some((tag) => tag.includes("\0"))
      ) {
        throw new Error("角色卡包含无效字符。");
      }
      character.createdAt =
        isText(record.createdAt, 120, true) &&
        Number.isFinite(Date.parse(record.createdAt))
          ? record.createdAt
          : FALLBACK_CREATED_AT;
      custom.push(character);
      usedCharacterIds.add(id);
      knownCharacters.set(id, character);
    } catch {
      warnings.push(`第 ${index + 1} 个本地角色无效，已跳过该角色。`);
    }
  });

  const conversations: DzmmSavedConversation[] = [];
  const conversationRecords = readArray(saved, "conversations", warnings);
  const reservedConversationIds = reservedIds(conversationRecords);
  const usedConversationIds = new Set<string>();
  conversationRecords.forEach((record, index) => {
    try {
      if (!isRecord(record)) throw new Error("聊天记录格式无效。");
      const characterId = readId(record.characterId);
      const character = characterId
        ? knownCharacters.get(characterId)
        : undefined;
      if (!characterId || (!character && !isDzmmPublishedCharacterId(characterId))) throw new Error("聊天记录的角色不存在。");
      const messages = hydrateMessages(record.messages, index);
      const id = recordId(
        record.id,
        `saved-conversation-${index}`,
        reservedConversationIds,
        usedConversationIds,
      );
      const title = isText(record.title, 12_000, true)
        ? record.title
        : character?.name ?? "公开角色";
      const updatedAt =
        typeof record.updatedAt === "number" &&
        Number.isFinite(record.updatedAt) &&
        record.updatedAt >= 0 &&
        record.updatedAt <= MAX_DATE_TIMESTAMP
          ? record.updatedAt
          : 0;
      if (record.title !== undefined && title !== record.title) {
        warnings.push(`第 ${index + 1} 个对话标题无效，已使用角色名称。`);
      }
      if (record.updatedAt !== undefined && updatedAt !== record.updatedAt) {
        warnings.push(`第 ${index + 1} 个对话时间无效，已恢复默认值。`);
      }
      let opening: DzmmConversationOpeningSnapshot | undefined;
      if (record.opening !== undefined) {
        try { opening = parseDzmmConversationOpening(record.opening); }
        catch { warnings.push(`第 ${index + 1} 个对话的开场无效，已忽略开场设置并保留原始消息。`); }
      }
      let storyMemory: DzmmStoryMemory | undefined;
      if (record.storyMemory !== undefined) {
        try {
          const parsed = parseStoryMemory(record.storyMemory);
          if (!matchesDzmmStoryMemory(parsed, messages)) throw new Error("剧情记忆的来源已改变。");
          storyMemory = parsed;
        } catch {
          warnings.push(`第 ${index + 1} 个对话的剧情记忆无效或已过期，已忽略记忆并保留原始消息。`);
        }
      }
      let worldState: DzmmWorldJournal | undefined;
      if (record.worldState !== undefined) {
        try {
          // Edits and rewinds retain only checkpoints whose exact source prefix still exists.
          worldState = pruneDzmmWorldJournal(parseDzmmWorldJournal(record.worldState), messages);
        } catch {
          warnings.push(`第 ${index + 1} 个对话的世界状态无效，已忽略状态并保留原始消息。`);
        }
      }
      const worldClockMode = record.worldClockMode === "story" || record.worldClockMode === "realtime"
        ? record.worldClockMode : undefined;
      if (record.worldClockMode !== undefined && worldClockMode === undefined) {
        warnings.push(`第 ${index + 1} 个对话的世界时间模式无效，已忽略该设置。`);
      }
      const phase = record.phase === "adventure" || record.phase === "chat" ? record.phase : undefined;
      conversations.push({ id, characterId, title, messages, updatedAt, ...(phase ? { phase } : {}), ...(opening ? { opening } : {}), ...(storyMemory ? { storyMemory } : {}),
        ...(worldState ? { worldState } : {}), ...(worldClockMode ? { worldClockMode } : {}) });
    } catch {
      warnings.push(`第 ${index + 1} 个本地对话无效，已跳过该对话。`);
    }
  });

  const favorites = new Set<string>();
  const favoriteRecords = readArray(saved, "favorites", warnings);
  let invalidFavorites = false;
  for (const record of favoriteRecords) {
    const id = readId(record);
    if (id && (knownCharacters.has(id) || isDzmmPublishedCharacterId(id))) favorites.add(id);
    else invalidFavorites = true;
  }
  if (invalidFavorites) warnings.push("已移除无效或角色不存在的收藏记录。");

  return {
    state: {
      version: 1,
      favorites: [...favorites],
      custom,
      conversations,
      preferences: hydratePreferences(saved.preferences, warnings),
    },
    warnings,
  };
}
