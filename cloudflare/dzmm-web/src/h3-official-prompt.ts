import { endpoint, messageText, type CanvasAgentEnv } from "./canvas-agent";
import { H3_BASE_GUIDE, H3_REF_GUIDE } from "./h3-official-guide";

const SECTIONS = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"];
const MAX_PROMPT = 8000;

export interface H3Reference {
  kind: "image" | "video" | "audio";
  label: string;
  data?: string;
}

function brief(prompt: string, references: H3Reference[], seconds: number, width: number, height: number): string {
  const counters = { image: 0, video: 0, audio: 0 };
  const tags = { image: "Picture", video: "Video", audio: "Audio" };
  const listed = references.map((item) => {
    counters[item.kind] += 1;
    return `- <${tags[item.kind]} ${counters[item.kind]}>：${item.label || "未命名素材"}`;
  });
  return [
    "Rewrite the request below into a MiniMax H3 full-reference (Ref2VA) prompt, following the two official guides above exactly.",
    "Output only the six sections, in order, each starting with its field name and a colon: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music. No Markdown, no code fences, no commentary.",
    `Target video: ${seconds.toFixed(2)} seconds, ${width === height ? "square" : width > height ? "horizontal" : "vertical"} ${width}x${height}, one continuous shot ([Shot 1] only, no cuts).`,
    "Reference assets, in upload order (the attached images follow the same order):",
    ...listed,
    "The first picture whose name does not start with 角色 is the first frame of [Shot 1]: use [keyframe completion] and write that the shot begins from it. Pictures named 角色·… are character references: define them as <Subject N> from that picture and use [reference generation].",
    "Keep every person's face, hair, clothing and props exactly as in the references. All characters are adults.",
    "Only include dialogue that the request itself contains; write it as <d>[Chinese] …</d> with a speaker ID. If the request has no lines, nobody speaks.",
    "Do not add subtitles, captions, logos or watermarks. Unless the request asks for music, non_diegetic_music is N/A.",
    "Request (Chinese):",
    prompt,
  ].join("\n");
}

function readSections(raw: string): string | null {
  const textOut = raw.replace(/\r/g, "").trim().slice(0, MAX_PROMPT);
  let cursor = -1;
  for (const name of SECTIONS) {
    const index = textOut.indexOf(name);
    if (index <= cursor) return null;
    cursor = index;
  }
  return textOut.slice(textOut.indexOf(SECTIONS[0]));
}

/** Rewrite a canvas video request into the official H3 Ref2VA prompt. Returns null when it cannot. */
export async function writeH3OfficialPrompt(
  env: CanvasAgentEnv,
  prompt: string,
  references: H3Reference[],
  { seconds = 5.08, width = 480, height = 864, fetchImpl = fetch }: { seconds?: number; width?: number; height?: number; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const upstream = endpoint(env);
  if (!upstream || !prompt.trim() || !references.length) return null;
  const images = references
    .filter((item) => item.kind === "image" && typeof item.data === "string" && item.data.startsWith("data:image/"))
    .slice(0, 4)
    .map((item) => ({ type: "image_url", image_url: { url: item.data } }));
  try {
    const response = await fetchImpl(upstream.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstream.key}`, "X-Title": "Xumeng H3 prompt" },
      body: JSON.stringify({
        model: upstream.model,
        temperature: 0.3,
        max_tokens: 2400,
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: `${H3_BASE_GUIDE}\n\n${H3_REF_GUIDE}` },
          { role: "user", content: [{ type: "text", text: brief(prompt, references, seconds, width, height) }, ...images] },
        ],
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return null;
    return readSections(messageText(await response.json().catch(() => null)));
  } catch {
    return null;
  }
}
