/** Derived presentation only: never rewrite the imported card or saved conversation. */
export type DzmmCharacterPresentation = { body: string; notes: string[] };

const AUTHOR_HEADING = /^(?:#{1,6}\s*)?(?:【|\[)?(?:作者备注|作者说明|作者注|作者的话|创作说明|测试说明|更新日志|版本说明|模型建议)(?:】|\])?(?:\s*[:：].*|\s*)$/u;
const STORY_HEADING = /^(?:#{1,6}\s*)?(?:正文|故事正文|角色正文)\s*[:：]?\s*$/u;
const POSTSCRIPT = /^(?:PS|P\.\s*S\.?|附言)\s*[:：]/iu;
const AUTHOR_CUES = /主要(?:测试|使用)(?:的)?模型|(?:建议|推荐)使用[^\n]{0,30}模型|首发(?:发现)?作者|更新说明[:：]|二次修改[（(]|卡有问题请/u;
const AUTHOR_PS = /^(?:PS|P\.\s*S\.?|附言)\s*[:：]\s*作者(?:注|备注|说明|补充|的话)(?:\s*[:：]|\s*$)/iu;
const CREDIT = /^(?:【|\[)(?:感谢|鸣谢)[^\n]{0,300}(?:跑图|绘图|画图|封面|配图|插画)[^\n]*(?:】|\])$/u;

function normalized(value: string): string {
  // The source's copied CR + backslash + LF separator is not authored punctuation.
  return value.replace(/\r\\\n/g, "\n").replace(/\r\n?/g, "\n");
}

/** Only clear, standalone author sections are separated. An in-world PS stays prose. */
export function splitDzmmCharacterPresentation(text: string, creatorNotes?: string): DzmmCharacterPresentation {
  const lines = normalized(text).split("\n");
  const body: string[] = [];
  const notes: string[] = [];
  let section: string[] | undefined;
  let fence: { marker: string; length: number } | undefined;
  const quotes: string[] = [];
  let beforeStory = true;
  const addNote = (value: string) => {
    const note = value.trim();
    if (note && !notes.includes(note)) notes.push(note);
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    const literal = Boolean(fence || quotes.length || /^(?: {4}|\t)/u.test(line));
    if (!literal && !section && beforeStory && CREDIT.test(trimmed)) { addNote(line); continue; }
    if (!literal && section && STORY_HEADING.test(trimmed)) {
      addNote(section.join("\n")); section = undefined; beforeStory = false; continue;
    }
    let authorPostscript = false;
    if (!literal && !section && POSTSCRIPT.test(trimmed)) {
      let end = index + 1;
      while (end < lines.length && !POSTSCRIPT.test(lines[end].trim()) && !AUTHOR_HEADING.test(lines[end].trim())
        && !STORY_HEADING.test(lines[end].trim()) && !/^\s*(?:`{3,}|~{3,})/u.test(lines[end])) end++;
      const unquoted = lines.slice(index, end).join("\n").replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, "");
      authorPostscript = AUTHOR_PS.test(trimmed) || AUTHOR_CUES.test(unquoted);
    }
    if (!literal && !section && (AUTHOR_HEADING.test(trimmed) || authorPostscript)) section = [];
    if (section) section.push(line);
    else { body.push(line); if (trimmed) beforeStory = false; }
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    }
    if (!fence && !marker && !section && !/^(?: {4}|\t)/u.test(line)) {
      const pairs: Record<string, string> = { "“": "”", "「": "」", "『": "』" };
      for (let position = 0; position < line.length; position++) {
        const char = line[position];
        if (line[position - 1] === "\\") continue;
        if (quotes.at(-1) === char) quotes.pop();
        else if (pairs[char]) quotes.push(pairs[char]);
        else if (char === '"') quotes.push(char);
      }
    }
  }
  if (section) addNote(section.join("\n"));
  if (creatorNotes) addNote(normalized(creatorNotes));
  return { body: body.join("\n").trim(), notes };
}

const READER_NAME = /\{\{\s*(char|user)\s*\}\}/gi;

/** Display-only substitution. The card text stays unchanged, and a name is not expanded again. */
export function applyDzmmReaderNames(text: string, names: { characterName?: string; userName?: string }): string {
  return text.replace(READER_NAME, (match, name: string) => {
    const value = (name.toLowerCase() === "char" ? names.characterName : names.userName)?.trim();
    return value || match;
  });
}

export function getDzmmCharacterPreviewText(character: { name?: string; introduction?: string; description?: string; catalogReadiness?: string }, userName?: string): string {
  const preview = splitDzmmCharacterPresentation(character.introduction?.trim() ? character.introduction : character.description || "").body;
  const named = userName ? applyDzmmReaderNames(preview, { characterName: character.name, userName }) : preview;
  return named || (character.catalogReadiness === "metadata-only" ? "人物背景与开场待补充" : "");
}

export function getDzmmCharacterCreatorNotes(character: StoryCharacter & { introduction?: string; creatorNotes?: string }): string[] {
  return [...new Set([character.introduction, character.description, character.firstMessage,
    ...character.openingMessages?.filter(message => message.role === "assistant").map(message => message.content) ?? [],
    ...character.alternateGreetings ?? []]
    .flatMap(text => splitDzmmCharacterPresentation(text || "").notes)
    .concat(splitDzmmCharacterPresentation("", character.creatorNotes).notes))];
}

type OpeningMessage = { role: "user" | "assistant"; content: string };
type StoryCharacter = {
  description?: string; personality?: string; scenario?: string; firstMessage?: string;
  openingMessages?: OpeningMessage[]; alternateGreetings?: string[];
};

export function projectDzmmOpeningMessage(message: OpeningMessage): OpeningMessage {
  return { role: message.role, content: message.role === "assistant"
    ? splitDzmmCharacterPresentation(message.content).body : message.content.trim() };
}

/** Description/opening are reader prose; personality/scenario remain authored model instructions. */
export function projectDzmmStoryCharacter<T extends StoryCharacter>(character: T): T {
  const result = { ...character };
  for (const key of ["description", "firstMessage"] as const) {
    if (typeof character[key] === "string") result[key] = splitDzmmCharacterPresentation(character[key]).body;
  }
  if (character.openingMessages) result.openingMessages = character.openingMessages.map(projectDzmmOpeningMessage).filter(message => message.content);
  if (character.alternateGreetings) result.alternateGreetings = character.alternateGreetings.map(text => splitDzmmCharacterPresentation(text).body);
  return result;
}

/** Clean only a matching, card-derived history prefix; do not reinterpret arbitrary user chats. */
export function projectDzmmSourceOpeningHistoryEntries(character: StoryCharacter, messages: readonly OpeningMessage[]): { sourceIndex: number; message: OpeningMessage }[] {
  const candidates: OpeningMessage[][] = [];
  if (character.openingMessages?.length) candidates.push(character.openingMessages);
  else if (character.firstMessage?.trim()) candidates.push([{ role: "assistant", content: character.firstMessage }]);
  for (const greeting of character.alternateGreetings ?? []) candidates.push([{ role: "assistant", content: greeting }]);
  if (!character.openingMessages?.length && !character.firstMessage?.trim()) {
    const background = character.scenario?.trim() || character.description?.trim();
    if (background) candidates.push([{ role: "assistant", content: background }]);
  }
  const prefix = candidates.find(candidate => candidate.every((opening, index) => {
    const message = messages[index];
    return message?.role === opening.role && (message.content.trim() === opening.content.trim()
      || projectDzmmOpeningMessage(message).content === projectDzmmOpeningMessage(opening).content);
  }));
  return messages.flatMap((message, index) => {
    const projected = prefix && index < prefix.length ? projectDzmmOpeningMessage(message) : { ...message };
    return projected.content ? [{ sourceIndex: index, message: projected }] : [];
  });
}

export function projectDzmmSourceOpeningHistory(character: StoryCharacter, messages: readonly OpeningMessage[]): OpeningMessage[] {
  return projectDzmmSourceOpeningHistoryEntries(character, messages).map(entry => entry.message);
}
