import { prepareDzmmRequest } from "./dzmm-context";
import { normalizeDzmmModelSelection } from "./dzmm-models";
import { applyDzmmConversationOpening } from "./dzmm-conversation-context";
import { captureDzmmReplySuggestionContext } from "./dzmm-message-actions";
import { DZMM_ILLUSTRATION_MAX_TOKENS, parseDzmmIllustrationShots, type DzmmIllustrationShot } from "./dzmm-illustration";
import type { Character } from "./dzmm-characters";
import { resolveDzmmConversationPersona, type DzmmPreferences, type DzmmSavedConversation } from "./dzmm-storage";

export function prepareDzmmIllustrationRequest(character: Character, conversation: DzmmSavedConversation,
  messageId: string, preferences: DzmmPreferences, pov: boolean) {
  if (character.authoringDraft) throw new Error("请先在创作中心完善角色世界书，再构思画面。");
  const context = captureDzmmReplySuggestionContext(conversation, messageId);
  const snapshot = context.worldState?.snapshots.at(-1);
  const request = prepareDzmmRequest(applyDzmmConversationOpening(character, context),
    [...context.messages, { role: "user", content: "根据这轮剧情构思三张画面。" }],
    preferences.preset, resolveDzmmConversationPersona(preferences, conversation.id), normalizeDzmmModelSelection(preferences.model),
    DZMM_ILLUSTRATION_MAX_TOKENS, { userName: preferences.nickname, storyMemory: context.storyMemory,
      ...(snapshot ? { world: { clockMode: snapshot.clockMode, state: snapshot.state, recordedAt: snapshot.recordedAt } } : {}),
      locale: preferences.locale });
  if (request.messages.length < 2 || request.messages.at(-2)?.role !== "assistant") {
    throw new Error("角色设定过长，无法保留当前回复。请精简设定后再构思画面。");
  }
  return { ...request, pov };
}

export class DzmmIllustrationError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); this.name = "DzmmIllustrationError"; }
}

export async function fetchDzmmIllustrations(request: ReturnType<typeof prepareDzmmIllustrationRequest>,
  signal: AbortSignal): Promise<DzmmIllustrationShot[]> {
  signal.throwIfAborted();
  const response = await fetch("/api/illustrations", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Xumeng-Request-Id": crypto.randomUUID() },
    body: JSON.stringify(request), signal });
  const payload: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    throw new DzmmIllustrationError(response.status, typeof body?.error === "string" ? body.error : "画面构思失败，请重试。",
      typeof body?.code === "string" ? body.code : undefined);
  }
  try { return parseDzmmIllustrationShots(payload); }
  catch (error) { throw new DzmmIllustrationError(502, error instanceof Error ? error.message : "画面构思失败，请重试。"); }
}
