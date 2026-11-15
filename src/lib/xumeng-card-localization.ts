import type { Character } from "./dzmm-characters";
import type { XumengLocale } from "./xumeng-i18n";

export type XumengCardTranslation = {
  name?: string;
  tags?: string[];
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
};

type TranslationTable = Record<string, Partial<Record<XumengLocale, XumengCardTranslation>>>;
let table: TranslationTable = {};
const loadedLocales = new Set<XumengLocale>(["zh-Hans"]);
let pending: Promise<boolean> | null = null;

export function xumengCardTranslationsLoaded(locale: XumengLocale): boolean {
  return locale === "zh-Hans" || loadedLocales.has(locale);
}

export function hasXumengCardTranslation(characterId: string, locale: XumengLocale): boolean {
  return Boolean(table[characterId]?.[locale]);
}

/** The translation table stays out of the first script. Chinese never downloads it. */
export async function loadXumengCardTranslations(locale: XumengLocale): Promise<boolean> {
  if (locale === "zh-Hans" || loadedLocales.has(locale)) return false;
  pending ??= import("./xumeng-card-translations.json").then((module) => {
    const imported = module as { default?: TranslationTable };
    const rows = imported.default ?? {};
    table = rows;
    for (const row of Object.values(rows)) {
      if (!row) continue;
      for (const loc of Object.keys(row) as XumengLocale[]) loadedLocales.add(loc);
    }
    return true;
  }).catch(() => {
    pending = null;
    return false;
  });
  return pending;
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function xumengCardTranslation(characterId: string, locale: XumengLocale): XumengCardTranslation | null {
  const value = table[characterId]?.[locale];
  return value && typeof value === "object" ? value : null;
}

export function localizeCharacter(character: Character, locale: XumengLocale): Character {
  const translation = xumengCardTranslation(character.id, locale);
  if (!translation) return character;
  return {
    ...character,
    tags: localizedCharacterTags(character, locale),
    name: nonEmpty(translation.name, character.name),
    description: nonEmpty(translation.description, character.description),
    personality: nonEmpty(translation.personality, character.personality),
    scenario: nonEmpty(translation.scenario, character.scenario),
    firstMessage: nonEmpty(translation.firstMessage, character.firstMessage),
  };
}

export function localizedCharacterTags(character: Character, locale: XumengLocale): string[] {
  const translation = xumengCardTranslation(character.id, locale);
  return Array.isArray(translation?.tags) && translation.tags.length === character.tags.length
    ? translation.tags.map((tag, index) => nonEmpty(tag, character.tags[index] ?? ""))
    : character.tags;
}

export function sourceCharacterTag(character: Character, locale: XumengLocale, tag: string): string {
  const localized = localizedCharacterTags(character, locale);
  const index = localized.indexOf(tag);
  return index >= 0 ? character.tags[index] ?? tag : tag;
}

export function xumengLocalizedAuthorName(author: string, locale: XumengLocale): string {
  if (author !== "叙梦管理员") return author;
  if (locale === "en") return "XUMENG Admin";
  if (locale === "ja") return "XUMENG管理者";
  if (locale === "ko") return "XUMENG 관리자";
  if (locale === "zh-Hant") return "叙夢管理員";
  return author;
}
