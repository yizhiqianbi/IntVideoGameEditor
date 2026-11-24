import {
  SHELF_CONTEXT_LIMIT_CHARS,
  SHELF_REQUEST_LIMIT_BYTES,
  ShelfValidationError,
  buildShelfPromptPlan,
  validateShelfChatInput,
  type ShelfCharacter,
  type ShelfChatMessage,
  type ShelfModelPreset,
  type ShelfWorldContext,
} from "./shelf-chat";
import {
  activateShelfCharacterBook,
  countShelfContextText,
  SHELF_CHARACTER_PROSE_LIMIT,
  SHELF_CHARACTER_PROMPT_FIELDS,
  mergeShelfOpeningMessages,
  parseShelfCharacterContext,
  resolveShelfOpeningMessages,
} from "./shelf-character-context";
import { matchesShelfStoryMemory, type ShelfStoryMemory, type ShelfStoryState } from "./shelf-story-memory";
import { projectShelfSourceOpeningHistoryEntries, projectShelfStoryCharacter, splitShelfCharacterPresentation } from "./shelf-character-presentation";
import { FOLIO_DEFAULT_LOCALE, type FolioLocale } from "./folio-i18n";
import { applyFolioFrontendScripts, type FolioFrontendScript } from "./folio-frontend-card";

export type ShelfPreparedRequest = {
  character: ShelfCharacter;
  messages: ShelfChatMessage[];
  preset?: string;
  userPersona?: string;
  userName?: string;
  storyMemory?: ShelfStoryState;
  world?: ShelfWorldContext;
  model: ShelfModelPreset;
  maxTokens?: number;
  locale?: FolioLocale;
};

function frontendScriptsOf(character: object): readonly FolioFrontendScript[] | undefined {
  const scripts = (character as { frontendScripts?: unknown }).frontendScripts;
  return Array.isArray(scripts) ? scripts as FolioFrontendScript[] : undefined;
}

function applyFrontendPrompt(messages: readonly ShelfChatMessage[], scripts: readonly FolioFrontendScript[] | undefined): ShelfChatMessage[] {
  if (!scripts?.some(script => !script.disabled && (script.promptOnly || (!script.promptOnly && !script.markdownOnly)))) return [...messages];
  return messages.map((message, index) => {
    const content = applyFolioFrontendScripts(message.content, scripts, {
      role: message.role, depth: messages.length - 1 - index, pass: "prompt",
    }).trim();
    return content && content !== message.content ? { role: message.role, content } : message;
  });
}

/** Keep a recent context tail that fits both the API's text and UTF-8 body limits. */
export function prepareShelfRequest(
  character: Readonly<ShelfCharacter>,
  messages: ReadonlyArray<Readonly<ShelfChatMessage>>,
  preset?: string,
  userPersona?: string,
  model: ShelfModelPreset = "balanced",
  maxTokens?: number,
  options: { storyMemory?: ShelfStoryMemory; userName?: string; world?: ShelfWorldContext; locale?: FolioLocale } = {},
): ShelfPreparedRequest {
  const { name, description, personality, scenario, firstMessage } = projectShelfStoryCharacter(character);
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user") {
    throw new ShelfValidationError("请先输入一条用户消息，再生成角色回复。");
  }
  const memory = matchesShelfStoryMemory(options.storyMemory, messages) ? options.storyMemory : undefined;
  let context: ReturnType<typeof parseShelfCharacterContext>;
  try {
    context = projectShelfStoryCharacter(parseShelfCharacterContext(Object.fromEntries(SHELF_CHARACTER_PROMPT_FIELDS
      .flatMap(field => character[field] === undefined ? [] : [[field, character[field]]]))));
  } catch (error) {
    throw new ShelfValidationError(error instanceof Error ? error.message : "角色扩展设定无效。");
  }
  // Resolve the chosen scene from the complete conversation before its early turns are trimmed.
  const opening = resolveShelfOpeningMessages({ firstMessage, ...context }, messages);
  const { characterBook, alternateGreetings, openingMessages, ...fixedContext } = context;
  const selectedAlternative = messages[0]?.role === "assistant"
    && Boolean(alternateGreetings?.some(greeting => greeting.trim() === splitShelfCharacterPresentation(messages[0].content).body))
    && !(openingMessages?.length && openingMessages.every((message, index) => messages[index]?.role === message.role
      && (message.role === "assistant" ? splitShelfCharacterPresentation(messages[index]?.content || "").body : messages[index]?.content.trim()) === message.content.trim()));
  const explicitOpening = Boolean(openingMessages?.length || selectedAlternative);
  // Validate fixed fields separately from unused lore entries and unselected greetings.
  const normalized = validateShelfChatInput({
    character: { name, description, personality, scenario, firstMessage: explicitOpening ? undefined : firstMessage,
      ...fixedContext, ...(explicitOpening ? { openingMessages: opening } : {}) },
    messages: [{ role: latest.role, content: latest.content }],
    preset,
    userPersona,
    model,
    maxTokens,
    userName: options.userName,
    locale: options.locale ?? FOLIO_DEFAULT_LOCALE,
    storyMemory: memory?.state,
    world: options.world,
  });
  // Validate the raw history before projecting only card-derived opening metadata.
  const validatedHistory = messages.map((message): ShelfChatMessage => {
    if ((message.role !== "user" && message.role !== "assistant")
      || typeof message.content !== "string" || !message.content.trim()
      || message.content.length > SHELF_CHARACTER_PROSE_LIMIT || message.content.includes("\0")) {
      throw new ShelfValidationError(`历史消息应为不超过 ${SHELF_CHARACTER_PROSE_LIMIT} 字的非空用户或角色消息，请检查导入的会话。`);
    }
    return { role: message.role, content: message.content.trim() };
  });
  const start = Math.max(messages.length - 40, Math.min(memory?.sourceCount ?? 0, messages.length - 1));
  const tail = applyFrontendPrompt(projectShelfSourceOpeningHistoryEntries(character, validatedHistory)
    .filter(entry => entry.sourceIndex >= start).map(entry => entry.message), frontendScriptsOf(character));
  const request: ShelfPreparedRequest = {
    character: normalized.character,
    messages: tail,
    preset: normalized.preset,
    userPersona: normalized.userPersona,
    ...(normalized.userName ? { userName: normalized.userName } : {}),
    ...(normalized.storyMemory ? { storyMemory: normalized.storyMemory } : {}),
    ...(normalized.world ? { world: normalized.world } : {}),
    model: normalized.model,
    ...(maxTokens === undefined ? {} : { maxTokens: normalized.maxTokens }),
    locale: normalized.locale ?? FOLIO_DEFAULT_LOCALE,
  };
  const encoder = new TextEncoder();
  function fits() {
    if (characterBook) request.character.characterBook = activateShelfCharacterBook(characterBook,
      mergeShelfOpeningMessages(opening, request.messages));
    const chars = countShelfContextText(request.character) + (request.preset?.length || 0)
      + (request.userPersona?.length || 0) + countShelfContextText(request.storyMemory) + countShelfContextText(request.world)
      + request.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (chars > SHELF_CONTEXT_LIMIT_CHARS || encoder.encode(JSON.stringify(request)).byteLength > SHELF_REQUEST_LIMIT_BYTES) return false;
    try { buildShelfPromptPlan({ ...request, maxTokens: request.maxTokens ?? 2048 }); return true; }
    catch (error) { if (error instanceof ShelfValidationError) return false; throw error; }
  }
  while (!fits()) {
    if (request.messages.length === 1) {
      throw new ShelfValidationError("角色设定、预设与最后一条消息总量过大，请缩短设定或消息后重试。");
    }
    request.messages.shift();
  }
  validateShelfChatInput(request);
  return request;
}
