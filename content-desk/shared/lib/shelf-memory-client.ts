import { prepareShelfRequest, type ShelfPreparedRequest } from "./shelf-context";
import type { ShelfCharacter, ShelfModelPreset, ShelfWorldContext } from "./shelf-chat";
import type { FolioLocale } from "./folio-i18n";
import { projectShelfSourceOpeningHistoryEntries } from "./shelf-character-presentation";
import { stripFolioPanelTails } from "./folio-interaction-panels";
import { stripFolioMomentTails } from "./folio-moment-status";
import { createShelfStoryMemory, matchesShelfStoryMemory, parseStoryMemory, parseStoryState, selectShelfMemoryUpdate,
  type ShelfStoryMemory, type ShelfStoryMessage } from "./shelf-story-memory";

export type ShelfRememberedRequestOptions = {
  character: ShelfCharacter;
  messages: readonly ShelfStoryMessage[];
  memory?: ShelfStoryMemory;
  world?: ShelfWorldContext;
  preset?: string;
  userPersona?: string;
  userName?: string;
  locale?: FolioLocale;
  model: ShelfModelPreset;
  maxTokens?: number;
  signal?: AbortSignal;
  memoryFetch?: typeof fetch;
  onMemory?: (memory: ShelfStoryMemory) => void;
  onSummaryStart?: () => void;
};

export class ShelfMemoryRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "ShelfMemoryRequestError"; }
}

/** Complete the covered-prefix + raw-tail chain before continuing a long conversation. */
export async function prepareShelfRememberedRequest(options: ShelfRememberedRequestOptions): Promise<{
  request: ShelfPreparedRequest; memory?: ShelfStoryMemory; summaryCalls: number;
}> {
  let memory = matchesShelfStoryMemory(options.memory, options.messages) ? parseStoryMemory(options.memory) : undefined;
  let summaryCalls = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    const request = prepareShelfRequest(options.character, options.messages, options.preset, options.userPersona,
      options.model, options.maxTokens, { storyMemory: memory, userName: options.userName, world: options.world, locale: options.locale });
    const projected = projectShelfSourceOpeningHistoryEntries(options.character, options.messages);
    // Omitted display-only opening turns are not a lost story prefix requiring an AI summary.
    const retained = projected.length - request.messages.length;
    const cutoff = retained > 0 ? projected[retained].sourceIndex : 0;
    const update = selectShelfMemoryUpdate(options.messages, memory, { minimumSourceCount: cutoff });
    if (!update) return { request, memory, summaryCalls };
    const from = memory?.sourceCount ?? 0;
    const summaryMessages = projected.filter(entry => entry.sourceIndex >= from && entry.sourceIndex < update.sourcePrefix.length)
      .map(({ message: { role, content } }) => ({ role, content: role === "assistant" ? stripFolioMomentTails(stripFolioPanelTails(content)) || "……" : content }));
    if (!summaryMessages.length) {
      memory = createShelfStoryMemory(update.previousState ?? { summary: "", scene: "", completed: [], pending: [], relationships: [], items: [] }, update.sourcePrefix);
      options.signal?.throwIfAborted(); options.onMemory?.(memory); continue;
    }
    // Large imported histories can be resumed from each saved successful batch.
    if (summaryCalls >= 12) throw new Error("这段历史较长，已保存整理进度。请稍后再次发送，继续整理剩余剧情。");
    options.onSummaryStart?.();
    const response = await (options.memoryFetch ?? fetch)("/api/memory", {
      method: "POST", credentials: "same-origin", headers: {
        "Content-Type": "application/json", "X-内容台-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({ messages: summaryMessages,
        ...(update.previousState ? { previousState: update.previousState } : {}), model: options.model }), signal: options.signal,
    });
    summaryCalls++;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "整理历史失败，请稍后重试。";
      throw new ShelfMemoryRequestError(response.status, detail);
    }
    if (!payload || typeof payload !== "object" || !("state" in payload)) throw new Error("剧情记忆返回格式无效，请重试。");
    const state = parseStoryState(payload.state);
    memory = createShelfStoryMemory(state, update.sourcePrefix);
    options.signal?.throwIfAborted();
    options.onMemory?.(memory);
  }
}
