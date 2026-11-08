import { DZMM_CATALOG_CHARACTERS, isDzmmListedCharacter, parseCharacterImport, type Character } from "./dzmm-characters";
import { getDzmmOpeningMessages } from "./dzmm-character-context";
import { projectDzmmStoryCharacter } from "./dzmm-character-presentation";
import { isDzmmPublishedCharacterId } from "./dzmm-storage";
import { isXumengPinnedCard } from "./xumeng-card-shelf";
import { xumengShelfStat } from "./xumeng-homepage-stats";

type CatalogReadiness = "metadata-only" | "public-context" | "full-card";
type CatalogCharacter = Character & { catalogReadiness?: CatalogReadiness };
const readinessRank: Record<CatalogReadiness, number> = { "metadata-only": 0, "public-context": 1, "full-card": 2 };

export const DZMM_CHARACTER_CONTEXT_MISSING = "这个角色的设定尚未补齐，请先导入角色卡或在定制中补充设定。";
export const DZMM_CHARACTER_UNLISTED = "这个角色已下架，无法开启新会话。";

/** Resolve saved conversations without republishing archived cards. Current
 * private/public cards win over the archive; no saved state is rewritten. */
export function mergeDzmmConversationCharacters(current: readonly Character[]): Character[] {
  const characters = new Map(DZMM_CATALOG_CHARACTERS.map(character => [character.id, character]));
  for (const character of current) characters.set(character.id, character);
  return [...characters.values()];
}

/** Check only a new/fresh conversation. Existing saved conversations may resume
 * even when a catalog card is metadata-only or no longer listed; do not rewrite
 * their messages/opening snapshots while refreshing catalog data. */
export function getDzmmNewConversationBlockReason(character: CatalogCharacter): string | null {
  if (character.catalogReadiness === "metadata-only" || character.promptOrigin === "unavailable") return DZMM_CHARACTER_CONTEXT_MISSING;
  if (character.sourceKind === "original" || character.publication) return null;
  if (!isDzmmListedCharacter(character)) return DZMM_CHARACTER_UNLISTED;
  return character.catalogReadiness === "public-context" || character.catalogReadiness === "full-card" ? null : DZMM_CHARACTER_CONTEXT_MISSING;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalShortText(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.length <= limit && !value.includes("\0") ? value : undefined;
}

function hasStoryContext(character: Character): boolean {
  const story = projectDzmmStoryCharacter(character);
  return [story.description, story.personality, story.scenario, story.systemPrompt].some(value => value?.trim())
    || getDzmmOpeningMessages(story).length > 0
    || Boolean(story.characterBook?.entries.some(entry => entry.enabled !== false && entry.content.trim()));
}

/** /characters also contains the current user's private cards. Only known,
 * explicitly public, complete catalog records may supplement the shared list. */
function parseSharedCharacter(value: unknown, local: CatalogCharacter): CatalogCharacter | null {
  if (!isRecord(value) || value.id !== local.id || value.sourceKind !== "public-summary"
    || value.publication !== undefined || value.authoringDraft != null
    || (value.promptOrigin !== "original" && value.promptOrigin !== "public-verbatim")) return null;
  // These files are pinned to a verified source commit in both deployments.
  // Keep their text, provenance and zero source counters together, even if a
  // stale endpoint returns different card fields under the same identifier.
  if (isXumengPinnedCard(local)) return local;
  // Older endpoints generated believable template text from directory metadata.
  // Content length alone is not evidence that those cards have been completed.
  const readiness = value.catalogReadiness;
  if (readiness !== "public-context" && readiness !== "full-card") return null;
  try {
    const parsed = parseCharacterImport(value, local.id);
    if (!hasStoryContext(parsed)) return null;
    const sourceUrl = optionalShortText(value.sourceUrl, 2048);
    const createdAt = optionalShortText(value.createdAt, 120);
    if (sourceUrl === undefined || !createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
    if (sourceUrl) {
      const url = new URL(sourceUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    }
    if (value.publicIntroductionSha256 !== undefined
      && (typeof value.publicIntroductionSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.publicIntroductionSha256))) return null;
    return {
      ...parsed,
      sourceKind: "public-summary",
      promptOrigin: value.promptOrigin,
      catalogReadiness: readiness,
      sourceUrl,
      createdAt,
      heat: xumengShelfStat(local.id, "heat", optionalShortText(value.heat, 32), local.heat),
      likes: xumengShelfStat(local.id, "likes", optionalShortText(value.likes, 32), local.likes),
      ...(typeof value.publicIntroductionSha256 === "string" ? { publicIntroductionSha256: value.publicIntroductionSha256 } : {}),
    };
  } catch { return null; }
}

/** One directory entry per public card, and one private card per unused name.
 * A listed or published card replaces the caller's private copy of the same id
 * or title. `suppressedPrivateIds` are private drafts already represented by a
 * listed publication, including after the draft title changes. */
export function selectDzmmDirectory(privateCards: readonly Character[], publicCards: readonly Character[], suppressedPrivateIds?: ReadonlySet<string>): Character[] {
  const publicIds = new Set<string>();
  const publicNames = new Set<string>();
  const listed: Character[] = [];
  for (const card of publicCards) {
    const name = card.name.trim();
    if (publicIds.has(card.id) || (name && publicNames.has(name))) continue;
    publicIds.add(card.id);
    if (name) publicNames.add(name);
    listed.push(card);
  }
  const seenNames = new Set<string>();
  const mine: Character[] = [];
  for (const card of privateCards) {
    const name = card.name.trim();
    if (suppressedPrivateIds?.has(card.id) || publicIds.has(card.id) || (name && (publicNames.has(name) || seenNames.has(name)))) continue;
    if (name) seenNames.add(name);
    mine.push(card);
  }
  return [...mine, ...listed];
}

/** Preserve the current catalog/order and ignore private, unlisted or malformed
 * remote records. A metadata-only response cannot replace a more complete card;
 * a confirmed remote card wins when it has equal or greater readiness. */
export function mergeDzmmSharedCatalog(bundled: readonly CatalogCharacter[], remote: unknown): Character[] {
  const merged = [...bundled];
  if (!Array.isArray(remote)) return merged;
  const indices = new Map(bundled.map((character, index) => [character.id, index]));
  for (const value of remote) {
    if (!isRecord(value) || typeof value.id !== "string") continue;
    const index = indices.get(value.id);
    if (index === undefined) continue;
    const local = merged[index];
    const incoming = parseSharedCharacter(value, local);
    if (!incoming) continue;
    const localReadiness = local.catalogReadiness ?? (local.promptOrigin === "public-verbatim" ? "public-context" : "metadata-only");
    if (readinessRank[incoming.catalogReadiness!] < readinessRank[localReadiness]) continue;
    merged[index] = incoming;
  }
  return merged;
}

/** Fill saved chats whose public card is not already on screen. A cancelled
 * load must stay eligible: recording it early made the next sync or catalog
 * refresh drop the card for the rest of the visit. */
export async function loadMissingPublishedCharacters<T extends { id: string }>(options: {
  ids: readonly string[];
  hasFullCard: (id: string) => boolean;
  attempted: Set<string>;
  load: (id: string) => Promise<T>;
  remember: (character: T) => void;
  onSettled?: (id: string) => void;
  isStopped?: () => boolean;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<void> {
  const halted = () => options.isStopped?.() === true || options.signal?.aborted === true;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of options.ids) {
    if (!isDzmmPublishedCharacterId(id) || seen.has(id) || options.attempted.has(id) || options.hasFullCard(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (!unique.length || halted()) return;
  let cursor = 0;
  const workers = Math.min(Math.max(1, options.concurrency ?? 6), unique.length);
  async function worker() {
    while (!halted()) {
      const index = cursor++;
      if (index >= unique.length) return;
      const id = unique[index];
      if (options.attempted.has(id) || options.hasFullCard(id)) {
        options.onSettled?.(id);
        continue;
      }
      try {
        const character = await options.load(id);
        if (halted()) return;
        options.attempted.add(id);
        if (character?.id === id) options.remember(character);
      } catch {
        if (halted()) return;
        options.attempted.add(id);
      }
      if (!halted()) options.onSettled?.(id);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
}
