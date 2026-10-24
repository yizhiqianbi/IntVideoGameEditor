import { prepareDzmmRequest, type DzmmPreparedRequest } from "./dzmm-context";
import type { DzmmCharacter, DzmmModelPreset, DzmmWorldContext } from "./dzmm-chat";
import type { XumengLocale } from "./xumeng-i18n";
import { projectDzmmSourceOpeningHistoryEntries } from "./dzmm-character-presentation";
import { createDzmmStoryMemory, matchesDzmmStoryMemory, parseStoryMemory, parseStoryState, selectDzmmMemoryUpdate,
  type DzmmStoryMemory, type DzmmStoryMessage } from "./dzmm-story-memory";

export type DzmmRememberedRequestOptions = {
  character: DzmmCharacter;
  messages: readonly DzmmStoryMessage[];
  memory?: DzmmStoryMemory;
  world?: DzmmWorldContext;
  preset?: string;
  userPersona?: string;
  userName?: string;
  locale?: XumengLocale;
  model: DzmmModelPreset;
  maxTokens?: number;
  signal?: AbortSignal;
  memoryFetch?: typeof fetch;
  onMemory?: (memory: DzmmStoryMemory) => void;
  onSummaryStart?: () => void;
};

export class DzmmMemoryRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmMemoryRequestError"; }
}

/** Complete the covered-prefix + raw-tail chain before continuing a long conversation. */
export async function prepareDzmmRememberedRequest(options: DzmmRememberedRequestOptions): Promise<{
  request: DzmmPreparedRequest; memory?: DzmmStoryMemory; summaryCalls: number;
}> {
  let memory = matchesDzmmStoryMemory(options.memory, options.messages) ? parseStoryMemory(options.memory) : undefined;
  let summaryCalls = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    const request = prepareDzmmRequest(options.character, options.messages, options.preset, options.userPersona,
      options.model, options.maxTokens, { storyMemory: memory, userName: options.userName, world: options.world, locale: options.locale });
    const projected = projectDzmmSourceOpeningHistoryEntries(options.character, options.messages);
    // Omitted display-only opening turns are not a lost story prefix requiring an AI summary.
    const retained = projected.length - request.messages.length;
    const cutoff = retained > 0 ? projected[retained].sourceIndex : 0;
    const update = selectDzmmMemoryUpdate(options.messages, memory, { minimumSourceCount: cutoff });
    if (!update) return { request, memory, summaryCalls };
    const from = memory?.sourceCount ?? 0;
    const summaryMessages = projected.filter(entry => entry.sourceIndex >= from && entry.sourceIndex < update.sourcePrefix.length)
      .map(({ message: { role, content } }) => ({ role, content }));
    if (!summaryMessages.length) {
      memory = createDzmmStoryMemory(update.previousState ?? { summary: "", scene: "", completed: [], pending: [], relationships: [], items: [] }, update.sourcePrefix);
      options.signal?.throwIfAborted(); options.onMemory?.(memory); continue;
    }
    // Large imported histories can be resumed from each saved successful batch.
    if (summaryCalls >= 12) throw new Error("这段历史较长，已保存整理进度。请稍后再次发送，继续整理剩余剧情。");
    options.onSummaryStart?.();
    const response = await (options.memoryFetch ?? fetch)("/api/memory", {
      method: "POST", credentials: "same-origin", headers: {
        "Content-Type": "application/json", "X-Xumeng-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({ messages: summaryMessages,
        ...(update.previousState ? { previousState: update.previousState } : {}), model: options.model }), signal: options.signal,
    });
    summaryCalls++;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "整理历史失败，请稍后重试。";
      throw new DzmmMemoryRequestError(response.status, `${detail} 原始对话仍已保留。`);
    }
    if (!payload || typeof payload !== "object" || !("state" in payload)) throw new Error("剧情记忆返回格式无效，请重试。");
    const state = parseStoryState(payload.state);
    memory = createDzmmStoryMemory(state, update.sourcePrefix);
    options.signal?.throwIfAborted();
    options.onMemory?.(memory);
  }
}
