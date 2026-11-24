import type { Character } from "./shelf-characters";
import type { FolioLocale } from "./folio-i18n";

export type FolioCardTranslation = {
  name?: string;
  tags?: string[];
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
};

type TranslationTable = Record<string, Partial<Record<FolioLocale, FolioCardTranslation>>>;
let table: TranslationTable = {};
const loadedLocales = new Set<FolioLocale>(["zh-Hans"]);
let pending: Promise<boolean> | null = null;

export function folioCardTranslationsLoaded(locale: FolioLocale): boolean {
  return locale === "zh-Hans" || loadedLocales.has(locale);
}

export function hasFolioCardTranslation(characterId: string, locale: FolioLocale): boolean {
  return Boolean(table[characterId]?.[locale]);
}

/** The translation table stays out of the first script. Chinese never downloads it. */
export async function loadFolioCardTranslations(locale: FolioLocale): Promise<boolean> {
  if (locale === "zh-Hans" || loadedLocales.has(locale)) return false;
  pending ??= import("./folio-card-translations.json").then((module) => {
    const imported = module as { default?: TranslationTable };
    const rows = imported.default ?? {};
    table = rows;
    for (const row of Object.values(rows)) {
      if (!row) continue;
      for (const loc of Object.keys(row) as FolioLocale[]) loadedLocales.add(loc);
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

export function folioCardTranslation(characterId: string, locale: FolioLocale): FolioCardTranslation | null {
  const value = table[characterId]?.[locale];
  return value && typeof value === "object" ? value : null;
}

export function localizeCharacter(character: Character, locale: FolioLocale): Character {
  const translation = folioCardTranslation(character.id, locale);
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

export function localizedCharacterTags(character: Character, locale: FolioLocale): string[] {
  const translation = folioCardTranslation(character.id, locale);
  return Array.isArray(translation?.tags) && translation.tags.length === character.tags.length
    ? translation.tags.map((tag, index) => nonEmpty(tag, character.tags[index] ?? ""))
    : character.tags;
}

export function sourceCharacterTag(character: Character, locale: FolioLocale, tag: string): string {
  const localized = localizedCharacterTags(character, locale);
  const index = localized.indexOf(tag);
  return index >= 0 ? character.tags[index] ?? tag : tag;
}

export function folioLocalizedAuthorName(author: string, locale: FolioLocale): string {
  if (author !== "内容台管理员") return author;
  if (locale === "en") return "内容台 Admin";
  if (locale === "ja") return "内容台管理者";
  if (locale === "ko") return "内容台 관리자";
  if (locale === "zh-Hant") return "叙夢管理員";
  return author;
}
