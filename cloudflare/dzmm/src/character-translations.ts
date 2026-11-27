import type { Character } from "../../../src/lib/dzmm-characters";
import type { XumengCardTranslation } from "../../../src/lib/xumeng-card-localization";
import type { XumengLocale } from "../../../src/lib/xumeng-i18n";
import type { Env } from "./types";

export const CHARACTER_TRANSLATION_LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const;
export type CharacterTranslationLocale = (typeof CHARACTER_TRANSLATION_LOCALES)[number];
export type CharacterTranslationsMap = Partial<Record<XumengLocale, XumengCardTranslation>>;
export type BackgroundExecutionContext = { waitUntil(promise: Promise<unknown>): void };

const LOCALE_SET = new Set<string>(CHARACTER_TRANSLATION_LOCALES);
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash-lite";
const OPENROUTER_HOST = "openrouter.ai";
const SEALION_HOST = "open-sealion.aiaigirl.com";
const SEALION_MODEL = "sealion-nova-pro";
const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const LOCALE_DESCRIPTIONS: Record<CharacterTranslationLocale, string> = {
  en: "Natural English (for global AI roleplay users)",
  "zh-Hans": "Simplified Chinese (简体中文)",
  "zh-Hant": "Traditional Chinese (繁體中文，自然貼近港台用語)",
  ja: "Natural Japanese (日本語、ロールプレイ向け自然な文体)",
  ko: "Natural Korean (한국어, 롤플레이에 자연스러운 문체)",
};

// High-frequency characters that strongly distinguish Traditional vs Simplified Chinese.
const TRADITIONAL_MARKERS = /[這為說個國們學會與對從進時發點後實書經頭開關體話見還動無問樣現裡過當業長門義區萬樂語號寫愛廳聽夢歲邊讓給師畫廣誰認設變證戲講讀買賣車馬鳥魚龍風雲電飛]/g;
const SIMPLIFIED_MARKERS = /[这为说个国们学会与对从进时发点后实书经头开关体话见还动无问样现里过当业长门义区万乐语号写爱厅听梦岁边让给师画广谁认设变证戏讲读买卖车马鸟鱼龙风云电飞]/g;

export type TranslationSourceFields = {
  name: string;
  tags: string[];
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
};

function cleanControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
}

function clipText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const trimmed = cleanControlChars(value).trim();
  if (!trimmed) return "";
  return [...trimmed].slice(0, maxChars).join("");
}

function clipSingleLine(value: unknown, maxChars: number): string {
  return clipText(value, maxChars).replace(/\s+/g, " ").trim();
}

export function extractTranslationSource(character: Pick<Character, "name" | "tags" | "description" | "personality" | "scenario" | "firstMessage">): TranslationSourceFields {
  const tags = Array.isArray(character.tags)
    ? character.tags
      .map((tag) => clipSingleLine(tag, 40))
      .filter(Boolean)
      .slice(0, 16)
    : [];
  return {
    name: clipSingleLine(character.name, 120),
    tags,
    description: clipText(character.description, 1200),
    personality: clipText(character.personality, 2000),
    scenario: clipText(character.scenario, 2000),
    firstMessage: clipText(character.firstMessage, 2500),
  };
}

/** Detect the dominant authoring language of a character card. */
export function detectCharacterSourceLocale(source: TranslationSourceFields): CharacterTranslationLocale {
  const sample = [source.name, source.tags.join(" "), source.description, source.firstMessage.slice(0, 240)].join(" ");
  const hangul = (sample.match(/[\uac00-\ud7af]/g) ?? []).length;
  const kana = (sample.match(/[\u3040-\u30ff]/g) ?? []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;

  if (hangul >= 4 && hangul >= kana) return "ko";
  if (kana >= 4) return "ja";
  if (cjk >= 4 && cjk * 2 >= latin) {
    const trad = (sample.match(TRADITIONAL_MARKERS) ?? []).length;
    const simp = (sample.match(SIMPLIFIED_MARKERS) ?? []).length;
    if (trad >= 3 && trad > simp * 1.4) return "zh-Hant";
    return "zh-Hans";
  }
  if (latin >= 6) return "en";
  if (cjk > 0) return "zh-Hans";
  return "zh-Hans";
}

/** Target locales that should be automatically generated for this character card. */
export function targetTranslationLocales(source: TranslationSourceFields): CharacterTranslationLocale[] {
  const origin = detectCharacterSourceLocale(source);
  return CHARACTER_TRANSLATION_LOCALES.filter((locale) => locale !== origin);
}

export async function computeTranslationSourceHash(source: TranslationSourceFields): Promise<string> {
  const canonical = JSON.stringify(source);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function lockedChatUrl(baseUrl: string, host: string): string | null {
  let endpoint: URL;
  try { endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`); }
  catch { return null; }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== host || endpoint.username || endpoint.password) return null;
  return endpoint.toString();
}

function replyText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const direct = (payload as { response?: unknown }).response;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const piece = (part as { text?: unknown }).text;
    return typeof piece === "string" ? piece : "";
  }).join("").trim();
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(stripped);
  if (direct) return direct;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(stripped.slice(start, end + 1));
  return null;
}

function sanitizeTranslationItem(raw: unknown, source: TranslationSourceFields): XumengCardTranslation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const name = clipSingleLine(item.name, 120);
  const description = clipText(item.description, 1200);
  const personality = clipText(item.personality, 2000);
  const scenario = clipText(item.scenario, 2000);
  const firstMessage = clipText(item.firstMessage, 2500);

  let tags: string[] | undefined;
  if (Array.isArray(item.tags)) {
    const cleaned = item.tags
      .map((tag) => clipSingleLine(tag, 40))
      .filter(Boolean)
      .slice(0, 16);
    if (source.tags.length > 0 && cleaned.length === source.tags.length) {
      tags = cleaned;
    } else if (cleaned.length > 0 && source.tags.length === 0) {
      tags = cleaned;
    }
  }

  if (!name && !description) return null;
  return {
    ...(name ? { name } : {}),
    ...(tags ? { tags } : {}),
    ...(description ? { description } : {}),
    ...(personality ? { personality } : {}),
    ...(scenario ? { scenario } : {}),
    ...(firstMessage ? { firstMessage } : {}),
  };
}

export function parseTranslationBatchOutput(
  rawText: string,
  source: TranslationSourceFields,
  targetLocales: readonly CharacterTranslationLocale[],
): CharacterTranslationsMap {
  const parsed = extractJsonObject(rawText);
  if (!parsed) return {};
  const result: CharacterTranslationsMap = {};
  for (const locale of targetLocales) {
    const sanitized = sanitizeTranslationItem(parsed[locale], source);
    if (sanitized) result[locale] = sanitized;
  }
  return result;
}

function buildTranslationPrompt(source: TranslationSourceFields, targetLocales: readonly CharacterTranslationLocale[]): { system: string; user: string } {
  const localeGuide = targetLocales.map((locale) => `- "${locale}": ${LOCALE_DESCRIPTIONS[locale]}`).join("\n");
  const system = [
    "You are a professional literary & AI roleplay character-card localizer for XUMENG (叙梦).",
    "Translate the provided character card fields accurately and naturally into every requested target locale.",
    "STRICT RULES:",
    "1. Return ONLY a single valid JSON object. No markdown fences, no commentary, no extra keys.",
    "2. Top-level keys MUST be the exact requested locale codes.",
    '3. Each locale value MUST be an object with keys: "name", "tags", "description", "personality", "scenario", "firstMessage".',
    "4. Preserve any {{user}} and {{char}} template placeholders verbatim.",
    "5. Keep the exact same number of items in `tags` as the source `tags` array, in the same order.",
    "6. If a source field is empty string, output an empty string for that field.",
    "7. Keep character tone, atmosphere, formatting, and persona faithful without adding commentary or censoring literary tone.",
  ].join("\n");

  const user = [
    "Target locales:",
    localeGuide,
    "",
    "Source character card JSON:",
    JSON.stringify(source),
  ].join("\n");
  return { system, user };
}

type ProviderAttempt = {
  name: string;
  run: () => Promise<string>;
};

function translationProviders(
  env: Env,
  prompt: { system: string; user: string },
  fetchImpl: typeof fetch,
): ProviderAttempt[] {
  const providers: ProviderAttempt[] = [];
  const openrouterKey = (env.TRANSLATION_API_KEY || env.GENERATION_OPENROUTER_API_KEY || "").trim();
  if (openrouterKey.length >= 20) {
    const url = lockedChatUrl((env.TRANSLATION_BASE_URL || "https://openrouter.ai/api/v1").trim(), OPENROUTER_HOST);
    const model = (env.TRANSLATION_MODEL || DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL;
    if (url) {
      providers.push({
        name: `openrouter:${model}`,
        run: async () => {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openrouterKey}`,
            },
            body: JSON.stringify({
              model,
              temperature: 0.2,
              max_tokens: 4096,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
            }),
            redirect: "manual",
            signal: AbortSignal.timeout(45_000),
          });
          if (!response.ok || (response.status >= 300 && response.status < 400)) {
            throw new Error(`openrouter_http_${response.status}`);
          }
          return replyText(await response.json());
        },
      });
    }
  }

  const sealionKey = (env.SEALION_API_KEY || "").trim();
  if (sealionKey.length >= 20) {
    const url = lockedChatUrl((env.SEALION_BASE_URL || `https://${SEALION_HOST}/v1`).trim(), SEALION_HOST);
    if (url) {
      providers.push({
        name: `sealion:${SEALION_MODEL}`,
        run: async () => {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sealionKey}`,
            },
            body: JSON.stringify({
              model: SEALION_MODEL,
              temperature: 0.2,
              max_tokens: 4096,
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
            }),
            redirect: "manual",
            signal: AbortSignal.timeout(45_000),
          });
          if (!response.ok || (response.status >= 300 && response.status < 400)) {
            throw new Error(`sealion_http_${response.status}`);
          }
          return replyText(await response.json());
        },
      });
    }
  }

  if (env.AI && typeof env.AI.run === "function") {
    providers.push({
      name: `workers-ai:${WORKERS_AI_MODEL}`,
      run: async () => {
        const output = await (env.AI as unknown as {
          run(model: string, input: Record<string, unknown>): Promise<unknown>;
        }).run(WORKERS_AI_MODEL, {
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          max_tokens: 4096,
          temperature: 0.2,
        });
        return replyText(output);
      },
    });
  }

  return providers;
}

export async function translateCharacterSource(
  source: TranslationSourceFields,
  targetLocales: readonly CharacterTranslationLocale[],
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ translations: CharacterTranslationsMap; provider: string } | null> {
  if (env.TRANSLATION_ENABLED === "false") return null;
  if (!source.name && !source.description) return null;
  if (!targetLocales.length) return null;

  const prompt = buildTranslationPrompt(source, targetLocales);
  const providers = translationProviders(env, prompt, fetchImpl);
  if (!providers.length) return null;

  for (const provider of providers) {
    try {
      const raw = await provider.run();
      if (!raw) continue;
      const translations = parseTranslationBatchOutput(raw, source, targetLocales);
      if (Object.keys(translations).length > 0) {
        return { translations, provider: provider.name };
      }
    } catch (error) {
      console.error("character_translation_provider_failed", {
        provider: provider.name,
        error: error instanceof Error ? error.message.slice(0, 180) : String(error),
      });
    }
  }
  return null;
}

type TranslationRow = {
  publication_id: string;
  revision: number;
  locale: string;
  name: string;
  tags_json: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  source_hash: string;
};

function rowToCardTranslation(row: TranslationRow): XumengCardTranslation | null {
  if (!LOCALE_SET.has(row.locale)) return null;
  let tags: string[] | undefined;
  try {
    const parsed = JSON.parse(row.tags_json) as unknown;
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
      if (cleaned.length > 0) tags = cleaned;
    }
  } catch { /* ignore invalid tags_json */ }
  const item: XumengCardTranslation = {
    ...(row.name ? { name: row.name } : {}),
    ...(tags ? { tags } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.personality ? { personality: row.personality } : {}),
    ...(row.scenario ? { scenario: row.scenario } : {}),
    ...(row.first_message ? { firstMessage: row.first_message } : {}),
  };
  return item.name || item.description ? item : null;
}

export async function saveCharacterTranslations(
  env: Pick<Env, "DB">,
  publicationId: string,
  revision: number,
  sourceHash: string,
  translations: CharacterTranslationsMap,
  provider: string,
): Promise<CharacterTranslationLocale[]> {
  const now = Date.now();
  const entries = Object.entries(translations).filter(
    ([locale, value]) => LOCALE_SET.has(locale) && value && (value.name || value.description),
  ) as [CharacterTranslationLocale, XumengCardTranslation][];
  if (!entries.length) return [];

  const statements = entries.map(([locale, item]) => env.DB.prepare(
    `INSERT INTO character_translations (
      publication_id, revision, locale, name, tags_json, description, personality, scenario, first_message, source_hash, provider, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(publication_id, revision, locale) DO UPDATE SET
      name = excluded.name,
      tags_json = excluded.tags_json,
      description = excluded.description,
      personality = excluded.personality,
      scenario = excluded.scenario,
      first_message = excluded.first_message,
      source_hash = excluded.source_hash,
      provider = excluded.provider,
      updated_at = excluded.updated_at`,
  ).bind(
    publicationId,
    revision,
    locale,
    item.name ?? "",
    JSON.stringify(item.tags ?? []),
    item.description ?? "",
    item.personality ?? "",
    item.scenario ?? "",
    item.firstMessage ?? "",
    sourceHash,
    provider,
    now,
  ));
  await env.DB.batch(statements);
  return entries.map(([locale]) => locale);
}

/** Read all stored translations for a single published revision. Tolerant if migration is not yet applied. */
export async function readCharacterTranslations(
  env: Pick<Env, "DB">,
  publicationId: string,
  revision: number,
): Promise<CharacterTranslationsMap> {
  try {
    const rows = await env.DB.prepare(
      `SELECT publication_id, revision, locale, name, tags_json, description, personality, scenario, first_message, source_hash
       FROM character_translations
       WHERE publication_id = ? AND revision = ?`,
    ).bind(publicationId, revision).all<TranslationRow>();
    const map: CharacterTranslationsMap = {};
    for (const row of rows.results) {
      const translation = rowToCardTranslation(row);
      if (translation) map[row.locale as XumengLocale] = translation;
    }
    return map;
  } catch {
    return {};
  }
}

/** Batch-read stored translations for a page of catalog items. */
export async function readCharacterTranslationsBatch(
  env: Pick<Env, "DB">,
  items: readonly { publicationId: string; revision: number }[],
): Promise<Map<string, CharacterTranslationsMap>> {
  const result = new Map<string, CharacterTranslationsMap>();
  if (!items.length) return result;
  const targetRevById = new Map<string, number>();
  for (const item of items) targetRevById.set(item.publicationId, item.revision);
  const ids = [...targetRevById.keys()];
  try {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT publication_id, revision, locale, name, tags_json, description, personality, scenario, first_message, source_hash
       FROM character_translations
       WHERE publication_id IN (${placeholders})`,
    ).bind(...ids).all<TranslationRow>();
    for (const row of rows.results) {
      if (targetRevById.get(row.publication_id) !== Number(row.revision)) continue;
      const translation = rowToCardTranslation(row);
      if (!translation) continue;
      const current = result.get(row.publication_id) ?? {};
      current[row.locale as XumengLocale] = translation;
      result.set(row.publication_id, current);
    }
  } catch {
    return result;
  }
  return result;
}

/** Read localized titles for all listed, approved publications for /v1/publishing/sitemap. */
export async function readSitemapLocalizedTitles(
  env: Pick<Env, "DB">,
): Promise<Map<string, Partial<Record<XumengLocale, string>>>> {
  const result = new Map<string, Partial<Record<XumengLocale, string>>>();
  try {
    const rows = await env.DB.prepare(
      `SELECT t.publication_id AS publication_id, t.locale AS locale, t.name AS name
       FROM character_translations t
       JOIN character_publications p ON p.id = t.publication_id
       WHERE p.is_listed = 1 AND p.approved_revision = t.revision AND t.name <> ''`,
    ).all<{ publication_id: string; locale: string; name: string }>();
    for (const row of rows.results) {
      if (!LOCALE_SET.has(row.locale)) continue;
      const title = clipSingleLine(row.name, 80);
      if (!title) continue;
      const current = result.get(row.publication_id) ?? {};
      current[row.locale as XumengLocale] = title;
      result.set(row.publication_id, current);
    }
  } catch {
    return result;
  }
  return result;
}

export type EnsureTranslationResult = {
  publicationId: string;
  revision: number;
  status: "translated" | "up-to-date" | "skipped" | "failed";
  translatedLocales: CharacterTranslationLocale[];
  existingLocales: CharacterTranslationLocale[];
  provider?: string;
};

/**
 * Idempotently ensure a submitted/approved revision has translations for all target locales.
 * Skips already-stored locales matching the current source hash so submit + approve never double-pays.
 */
export async function ensureCharacterTranslations(
  env: Env,
  input: { publicationId: string; revision: number; character: Pick<Character, "name" | "tags" | "description" | "personality" | "scenario" | "firstMessage"> },
  options: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<EnsureTranslationResult> {
  const source = extractTranslationSource(input.character);
  const targets = targetTranslationLocales(source);
  if (!targets.length || (!source.name && !source.description)) {
    return { publicationId: input.publicationId, revision: input.revision, status: "skipped", translatedLocales: [], existingLocales: [] };
  }

  const sourceHash = await computeTranslationSourceHash(source);
  const existingValid = new Set<CharacterTranslationLocale>();

  if (!options.force) {
    try {
      const rows = await env.DB.prepare(
        `SELECT locale, source_hash, name, description FROM character_translations WHERE publication_id = ? AND revision = ?`,
      ).bind(input.publicationId, input.revision).all<{ locale: string; source_hash: string; name: string; description: string }>();
      for (const row of rows.results) {
        if (LOCALE_SET.has(row.locale) && row.source_hash === sourceHash && (row.name || row.description)) {
          existingValid.add(row.locale as CharacterTranslationLocale);
        }
      }
    } catch {
      return { publicationId: input.publicationId, revision: input.revision, status: "skipped", translatedLocales: [], existingLocales: [] };
    }
  }

  const missing = targets.filter((locale) => !existingValid.has(locale));
  if (!missing.length) {
    return {
      publicationId: input.publicationId,
      revision: input.revision,
      status: "up-to-date",
      translatedLocales: [],
      existingLocales: [...existingValid],
    };
  }

  const output = await translateCharacterSource(source, missing, env, options.fetchImpl);
  if (!output) {
    return {
      publicationId: input.publicationId,
      revision: input.revision,
      status: "skipped",
      translatedLocales: [],
      existingLocales: [...existingValid],
    };
  }

  const saved = await saveCharacterTranslations(
    env,
    input.publicationId,
    input.revision,
    sourceHash,
    output.translations,
    output.provider,
  );
  return {
    publicationId: input.publicationId,
    revision: input.revision,
    status: saved.length > 0 ? "translated" : "failed",
    translatedLocales: saved,
    existingLocales: [...existingValid],
    provider: output.provider,
  };
}

/** Fire-and-forget silent background translation attached to Cloudflare Worker waitUntil(). */
export function scheduleCharacterTranslation(
  ctx: BackgroundExecutionContext | undefined,
  env: Env,
  input: { publicationId: string; revision: number; character: Pick<Character, "name" | "tags" | "description" | "personality" | "scenario" | "firstMessage"> },
): void {
  if (env.TRANSLATION_ENABLED === "false") return;
  const hasProvider = Boolean(
    (env.TRANSLATION_API_KEY || env.GENERATION_OPENROUTER_API_KEY || "").trim().length >= 20
    || (env.SEALION_API_KEY || "").trim().length >= 20
    || (env.AI && typeof env.AI.run === "function"),
  );
  if (!hasProvider) return;

  const task = ensureCharacterTranslations(env, input).catch((error) => {
    console.error("character_translation_background_failed", {
      publicationId: input.publicationId,
      revision: input.revision,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
  });
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
  }
}
