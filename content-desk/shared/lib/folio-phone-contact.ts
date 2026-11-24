import { splitShelfCharacterPresentation } from "./shelf-character-presentation";
import { createFolioLiveScene } from "./folio-live-scene";
import type { FolioLiveSource, FolioPerformanceCharacter } from "./folio-performance-character";

export const FOLIO_PHONE_DEFAULT_PERSONA = "这是一通正在进行的电话。你就是对方打过来找到的那个人，用自己的口吻说话。先接住刚刚那句，再按你现在的处境往下说。不介绍自己是模型，不念设定，不替对方决定要不要继续。没发生的事不说成已经发生。";
export const FOLIO_PHONE_DEFAULT_VOICE = "zh_female_liuchangnv_uranus_bigtts";

const narrative = (value: string, limit: number) => splitShelfCharacterPresentation(value).body
  .replace(/\0/g, "").trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");

/** A new contact has no inherited story facts or previous conversation. */
export function createFolioManualPhoneContact() {
  return { name: "", background: "", persona: FOLIO_PHONE_DEFAULT_PERSONA, voice: FOLIO_PHONE_DEFAULT_VOICE,
    scene: createFolioLiveScene("本次通话") };
}

/** Manual background is supplied by the caller; story references are never accepted here. */
export function buildFolioManualPhonePersona(name: string, background: string): string {
  const contactName = narrative(name, 120), contactBackground = narrative(background, 2000);
  return [FOLIO_PHONE_DEFAULT_PERSONA,
    contactName && `通话对象姓名：${contactName}`,
    contactBackground && `人物背景（只按已提供的资料理解，不补造未知经历）：\n${contactBackground}`,
  ].filter(Boolean).join("\n\n");
}

/** The picker can filter a different work without attaching its prose to this person. */
export function getFolioPhoneSourceReference(
  character: FolioPerformanceCharacter | null | undefined,
  source: FolioLiveSource | null | undefined,
): string {
  if (!character || !source) return "";
  const matchingNovel = character.source === "novel" && source.kind === "novel" && character.sourceId === source.sourceId;
  const matchingCard = character.source === "character" && source.kind === "character" && source.key === "character-library"
    && source.characterKeys.includes(character.key);
  return matchingNovel || matchingCard ? source.reference : "";
}

/** Reserve the bounded call reference for recent chapter prose before a general synopsis. */
export function getFolioPhoneCallReference(
  character: FolioPerformanceCharacter | null | undefined,
  source: FolioLiveSource | null | undefined,
): string {
  if (!character) return "";
  const context = splitShelfCharacterPresentation(character.context ?? "").body.replace(/\0/g, "").trim();
  if (context) return context.slice(-500).replace(/^[\uDC00-\uDFFF]/, "").replace(/[\uD800-\uDBFF]$/, "");
  return narrative(getFolioPhoneSourceReference(character, source), 500);
}
