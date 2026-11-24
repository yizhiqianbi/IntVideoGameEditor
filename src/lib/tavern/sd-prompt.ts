/** SillyTavern Image Generation prompt pipeline.
 * Templates, reply cleanup, and prefix joining follow the stable-diffusion extension.
 * Last Message is the mode used for a picture of the current chat reply.
 */

export const SILLYTAVERN_IMAGE_MODE = {
  tool: -2,
  message: -1,
  character: 0,
  user: 1,
  scenario: 2,
  rawLast: 3,
  now: 4,
  face: 5,
  free: 6,
  background: 7,
  characterMultimodal: 8,
  userMultimodal: 9,
  faceMultimodal: 10,
  freeExtended: 11,
} as const;

export type SillyTavernImageMode = (typeof SILLYTAVERN_IMAGE_MODE)[keyof typeof SILLYTAVERN_IMAGE_MODE];

export const SILLYTAVERN_DEFAULT_PREFIX = "best quality, absurdres, aesthetic,";
export const SILLYTAVERN_DEFAULT_NEGATIVE = "lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry";

export const SILLYTAVERN_PROMPT_TEMPLATES: Record<SillyTavernImageMode, string> = {
  [SILLYTAVERN_IMAGE_MODE.tool]: "The text prompt used to generate the image. Must represent an exhaustive description of the desired image that will allow an artist or a photographer to perfectly recreate it.",
  [SILLYTAVERN_IMAGE_MODE.message]: "[{{char}} sends a picture that contains: {{prompt}}].",
  [SILLYTAVERN_IMAGE_MODE.character]: "In the next response I want you to provide only a detailed comma-delimited list of keywords and phrases which describe {{char}}. The list must include all of the following items in this order: name, species and race, gender, age, clothing, occupation, physical features and appearances. Do not include descriptions of non-visual qualities such as personality, movements, scents, mental traits, or anything which could not be seen in a still photograph. Do not write in full sentences. Prefix your description with the phrase 'full body portrait,'",
  [SILLYTAVERN_IMAGE_MODE.face]: "In the next response I want you to provide only a detailed comma-delimited list of keywords and phrases which describe {{char}}. The list must include all of the following items in this order: name, species and race, gender, age, facial features and expressions, occupation, hair and hair accessories (if any), what they are wearing on their upper body (if anything). Do not describe anything below their neck. Do not include descriptions of non-visual qualities such as personality, movements, scents, mental traits, or anything which could not be seen in a still photograph. Do not write in full sentences. Prefix your description with the phrase 'close up facial portrait,'",
  [SILLYTAVERN_IMAGE_MODE.user]: "Ignore previous instructions and provide a detailed description of {{user}}'s physical appearance from the perspective of {{char}} in the form of a comma-delimited list of keywords and phrases. The list must include all of the following items in this order: name, species and race, gender, age, clothing, occupation, physical features and appearances. Do not include descriptions of non-visual qualities such as personality, movements, scents, mental traits, or anything which could not be seen in a still photograph. Do not write in full sentences. Prefix your description with the phrase 'full body portrait,'. Ignore the rest of the story when crafting this description. Do not reply as {{char}} when writing this description, and do not attempt to continue the story.",
  [SILLYTAVERN_IMAGE_MODE.scenario]: "Ignore previous instructions and provide a detailed description for all of the following: a brief recap of recent events in the story, {{char}}'s appearance, and {{char}}'s surroundings. Do not reply as {{char}} while writing this description.",
  [SILLYTAVERN_IMAGE_MODE.now]: `Ignore previous instructions. Your next response must be formatted as a single comma-delimited list of concise keywords. The list will describe of the visual details included in the last chat message.

Only mention characters by using pronouns ('he','his','she','her','it','its') or neutral nouns ('male', 'the man', 'female', 'the woman').

Ignore non-visible things such as feelings, personality traits, thoughts, and spoken dialog.

Add keywords in this precise order:
a keyword to describe the location of the scene,
a keyword to mention how many characters of each gender or type are present in the scene (minimum of two characters:
{{user}} and {{char}}, example: '2 men ' or '1 man 1 woman ', '1 man 3 robots'),

keywords to describe the relative physical positioning of the characters to each other (if a commonly known term for the positioning is known use it instead of describing the positioning in detail) + 'POV',

a single keyword or phrase to describe the primary act taking place in the last chat message,

keywords to describe {{char}}'s physical appearance and facial expression,
keywords to describe {{char}}'s actions,
keywords to describe {{user}}'s physical appearance and actions.

If character actions involve direct physical interaction with another character, mention specifically which body parts interacting and how.

A correctly formatted example response would be:
'(location),(character list by gender),(primary action), (relative character position) POV, (character 1's description and actions), (character 2's description and actions)'`,
  [SILLYTAVERN_IMAGE_MODE.rawLast]: "Ignore previous instructions and provide ONLY the last chat message string back to me verbatim. Do not write anything after the string. Do not reply as {{char}} when writing this description, and do not attempt to continue the story.",
  [SILLYTAVERN_IMAGE_MODE.background]: "Ignore previous instructions and provide a detailed description of {{char}}'s surroundings in the form of a comma-delimited list of keywords and phrases. The list must include all of the following items in this order: location, time of day, weather, lighting, and any other relevant details. Do not include descriptions of characters and non-visual qualities such as names, personality, movements, scents, mental traits, or anything which could not be seen in a still photograph. Do not write in full sentences. Prefix your description with the phrase 'background,'. Ignore the rest of the story when crafting this description. Do not reply as {{char}} when writing this description, and do not attempt to continue the story.",
  [SILLYTAVERN_IMAGE_MODE.faceMultimodal]: 'Provide an exhaustive comma-separated list of tags describing the appearance of the character on this image in great detail. Start with "close-up portrait".',
  [SILLYTAVERN_IMAGE_MODE.characterMultimodal]: 'Provide an exhaustive comma-separated list of tags describing the appearance of the character on this image in great detail. Start with "full body portrait".',
  [SILLYTAVERN_IMAGE_MODE.userMultimodal]: 'Provide an exhaustive comma-separated list of tags describing the appearance of the character on this image in great detail. Start with "full body portrait".',
  [SILLYTAVERN_IMAGE_MODE.freeExtended]: 'Ignore previous instructions and provide an exhaustive comma-separated list of tags describing the appearance of "{0}" in great detail. Start with {{charPrefix}} (sic) if the subject is associated with {{char}}.',
  [SILLYTAVERN_IMAGE_MODE.free]: "",
};

export function substituteSillyTavernParams(value: string, names: { char?: string; user?: string }): string {
  return String(value || "")
    .replaceAll("{{char}}", names.char || "character")
    .replaceAll("{{user}}", names.user || "user");
}

export function sillyTavernQuietPrompt(mode: SillyTavernImageMode, names: { char?: string; user?: string }, freeText = ""): string {
  if (mode === SILLYTAVERN_IMAGE_MODE.free) return freeText.trim();
  const template = SILLYTAVERN_PROMPT_TEMPLATES[mode] || "";
  return substituteSillyTavernParams(template, names).replaceAll("{0}", freeText.trim());
}

/** Standard cleanup turns the model reply into a comma-separated tag list. Non-Latin text keeps its words. */
export function processSillyTavernReply(value: string, minimal = false): string {
  let str = String(value || "");
  if (!str.trim()) return "";
  const keepWords = minimal || /[^\u0000-\u007f]/.test(str);
  if (keepWords) {
    str = str.normalize("NFD");
    return str.replace(/\s+/g, " ").trim();
  }
  str = str.replaceAll('"', "").replaceAll("“", "").replaceAll("\n", ", ").normalize("NFD");
  str = str.replace(/[^a-zA-Z0-9.,:_(){}<>[\]/\-'|#]+/g, " ");
  str = str.replace(/\s+/g, " ").trim();
  return str.split(",").map(part => part.trim()).filter(Boolean).join(", ");
}

export function combineSillyTavernPrefixes(first: string, second: string, macro = ""): string {
  const process = (value: string) => value.trim().replace(/^,|,$/g, "").trim();
  if (!second) return first;
  const left = process(first);
  const right = process(second);
  const combined = macro && left.includes(macro) ? left.replace(macro, right) : `${left}, ${right},`;
  return process(combined);
}

export function assembleSillyTavernImagePrompt(input: {
  scene: string;
  commonPrefix?: string;
  characterPrefix?: string;
  commonNegative?: string;
  characterNegative?: string;
  char?: string;
  user?: string;
}): { positive: string; negative: string } {
  const names = { char: input.char, user: input.user };
  const prefix = combineSillyTavernPrefixes(input.commonPrefix ?? SILLYTAVERN_DEFAULT_PREFIX, input.characterPrefix ?? "");
  const positive = substituteSillyTavernParams(combineSillyTavernPrefixes(prefix, input.scene), names);
  const negativePrefix = combineSillyTavernPrefixes(input.commonNegative ?? SILLYTAVERN_DEFAULT_NEGATIVE, input.characterNegative ?? "");
  return { positive, negative: substituteSillyTavernParams(negativePrefix, names) };
}

export type SillyTavernQuietMessage = { role: "user" | "assistant"; content: string };

export function sillyTavernQuietMessages(history: SillyTavernQuietMessage[], quietPrompt: string): SillyTavernQuietMessage[] {
  const turns = history
    .filter(turn => turn.role === "user" || turn.role === "assistant")
    .map(turn => ({ role: turn.role, content: turn.content.replace(/\s+/g, " ").trim().slice(0, 800) }))
    .filter(turn => turn.content);
  return [...turns, { role: "user", content: quietPrompt }];
}
