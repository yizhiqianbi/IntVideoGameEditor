export type CompanionStyle = { version: 1; personality: string; speakingStyle: string; relationshipStyle: string };

export const CLASSIC_LINES = ["", ""] as const;
export const CLASSIC_STYLE: CompanionStyle = {
  version: 1,
  personality: "",
  speakingStyle: "",
  relationshipStyle: "",
};
