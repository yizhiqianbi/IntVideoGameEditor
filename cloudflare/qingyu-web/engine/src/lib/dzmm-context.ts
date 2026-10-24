import {
  DZMM_CONTEXT_LIMIT_CHARS,
  DZMM_MAX_MESSAGE_CHARS,
  DZMM_REQUEST_LIMIT_BYTES,
  DzmmValidationError,
  buildDzmmPromptPlan,
  validateDzmmChatInput,
  type DzmmCharacter,
  type DzmmChatMessage,
  type DzmmModelPreset,
  type DzmmWorldContext,
} from "./dzmm-chat";
import {
  activateDzmmCharacterBook,
  countDzmmContextText,
  DZMM_CHARACTER_PROMPT_FIELDS,
  mergeDzmmOpeningMessages,
  parseDzmmCharacterContext,
  resolveDzmmOpeningMessages,
} from "./dzmm-character-context";
import { matchesDzmmStoryMemory, type DzmmStoryMemory, type DzmmStoryState } from "./dzmm-story-memory";
import { projectDzmmSourceOpeningHistoryEntries, projectDzmmStoryCharacter, splitDzmmCharacterPresentation } from "./dzmm-character-presentation";
import { XUMENG_DEFAULT_LOCALE, type XumengLocale } from "./xumeng-i18n";

export type DzmmPreparedRequest = {
  character: DzmmCharacter;
  messages: DzmmChatMessage[];
  preset?: string;
  userPersona?: string;
  userName?: string;
  storyMemory?: DzmmStoryState;
  world?: DzmmWorldContext;
  model: DzmmModelPreset;
  maxTokens?: number;
  locale?: XumengLocale;
};

/** Keep a recent context tail that fits both the API's text and UTF-8 body limits. */
export function prepareDzmmRequest(
  character: Readonly<DzmmCharacter>,
  messages: ReadonlyArray<Readonly<DzmmChatMessage>>,
  preset?: string,
  userPersona?: string,
  model: DzmmModelPreset = "balanced",
  maxTokens?: number,
  options: { storyMemory?: DzmmStoryMemory; userName?: string; world?: DzmmWorldContext; locale?: XumengLocale } = {},
): DzmmPreparedRequest {
  const { name, description, personality, scenario, firstMessage } = projectDzmmStoryCharacter(character);
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user") {
    throw new DzmmValidationError("请先输入一条用户消息，再生成角色回复。");
  }
  const memory = matchesDzmmStoryMemory(options.storyMemory, messages) ? options.storyMemory : undefined;
  let context: ReturnType<typeof parseDzmmCharacterContext>;
  try {
    context = projectDzmmStoryCharacter(parseDzmmCharacterContext(Object.fromEntries(DZMM_CHARACTER_PROMPT_FIELDS
      .flatMap(field => character[field] === undefined ? [] : [[field, character[field]]]))));
  } catch (error) {
    throw new DzmmValidationError(error instanceof Error ? error.message : "角色扩展设定无效。");
  }
  // Resolve the chosen scene from the complete conversation before its early turns are trimmed.
  const opening = resolveDzmmOpeningMessages({ firstMessage, ...context }, messages);
  const { characterBook, alternateGreetings, openingMessages, ...fixedContext } = context;
  const selectedAlternative = messages[0]?.role === "assistant"
    && Boolean(alternateGreetings?.some(greeting => greeting.trim() === splitDzmmCharacterPresentation(messages[0].content).body))
    && !(openingMessages?.length && openingMessages.every((message, index) => messages[index]?.role === message.role
      && (message.role === "assistant" ? splitDzmmCharacterPresentation(messages[index]?.content || "").body : messages[index]?.content.trim()) === message.content.trim()));
  const explicitOpening = Boolean(openingMessages?.length || selectedAlternative);
  // Validate fixed fields separately from unused lore entries and unselected greetings.
  const normalized = validateDzmmChatInput({
    character: { name, description, personality, scenario, firstMessage: explicitOpening ? undefined : firstMessage,
      ...fixedContext, ...(explicitOpening ? { openingMessages: opening } : {}) },
    messages: [{ role: latest.role, content: latest.content }],
    preset,
    userPersona,
    model,
    maxTokens,
    userName: options.userName,
    locale: options.locale ?? XUMENG_DEFAULT_LOCALE,
    storyMemory: memory?.state,
    world: options.world,
  });
  // Validate the raw history before projecting only card-derived opening metadata.
  const validatedHistory = messages.map((message): DzmmChatMessage => {
    if ((message.role !== "user" && message.role !== "assistant")
      || typeof message.content !== "string" || !message.content.trim()
      || message.content.length > DZMM_MAX_MESSAGE_CHARS || message.content.includes("\0")) {
      throw new DzmmValidationError("历史消息应为不超过 12000 字的非空用户或角色消息，请检查导入的会话。");
    }
    return { role: message.role, content: message.content.trim() };
  });
  const start = Math.max(messages.length - 40, Math.min(memory?.sourceCount ?? 0, messages.length - 1));
  const tail = projectDzmmSourceOpeningHistoryEntries(character, validatedHistory)
    .filter(entry => entry.sourceIndex >= start).map(entry => entry.message);
  const request: DzmmPreparedRequest = {
    character: normalized.character,
    messages: tail,
    preset: normalized.preset,
    userPersona: normalized.userPersona,
    ...(normalized.userName ? { userName: normalized.userName } : {}),
    ...(normalized.storyMemory ? { storyMemory: normalized.storyMemory } : {}),
    ...(normalized.world ? { world: normalized.world } : {}),
    model: normalized.model,
    ...(maxTokens === undefined ? {} : { maxTokens: normalized.maxTokens }),
    locale: normalized.locale ?? XUMENG_DEFAULT_LOCALE,
  };
  const encoder = new TextEncoder();
  function fits() {
    if (characterBook) request.character.characterBook = activateDzmmCharacterBook(characterBook,
      mergeDzmmOpeningMessages(opening, request.messages));
    const chars = countDzmmContextText(request.character) + (request.preset?.length || 0)
      + (request.userPersona?.length || 0) + countDzmmContextText(request.storyMemory) + countDzmmContextText(request.world)
      + request.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (chars > DZMM_CONTEXT_LIMIT_CHARS || encoder.encode(JSON.stringify(request)).byteLength > DZMM_REQUEST_LIMIT_BYTES) return false;
    try { buildDzmmPromptPlan({ ...request, maxTokens: request.maxTokens ?? 2048 }); return true; }
    catch (error) { if (error instanceof DzmmValidationError) return false; throw error; }
  }
  while (!fits()) {
    if (request.messages.length === 1) {
      throw new DzmmValidationError("角色设定、预设与最后一条消息总量过大，请缩短设定或消息后重试。");
    }
    request.messages.shift();
  }
  validateDzmmChatInput(request);
  return request;
}
