import type { Character } from "./dzmm-characters";
import translations from "./xumeng-card-translations.json";
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
const table = translations as TranslationTable;
const loadedLocales = new Set<XumengLocale>(["zh-Hans"]);

/** Load the larger public-card translation shard only when a translated locale is selected. */
export async function loadXumengCardTranslations(locale: XumengLocale): Promise<boolean> {
  if (locale === "zh-Hans" || loadedLocales.has(locale) || typeof fetch !== "function") return false;
  try {
    const response = await fetch(`/api/dzmm/translations/${locale}`, { cache: "no-store" });
    if (!response.ok) return false;
    const payload = await response.json() as Record<string, XumengCardTranslation>;
    for (const [id, translation] of Object.entries(payload)) {
      if (!translation || typeof translation !== "object") continue;
      table[id] = { ...(table[id] ?? {}), [locale]: translation };
    }
    loadedLocales.add(locale);
    return true;
  } catch {
    return false;
  }
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
