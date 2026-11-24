import type { CompanionStyle } from "./companion-style";

/** Custom-route presets. Names and voices follow the community cards. Ids stay for existing links. */
export type CompanionProfile = {
  id: string;
  name: string;
  line: string;
  cover: string;
  situation: string;
  introduction: string;
  style: CompanionStyle;
};

export const REALISTIC_COMPANION_PROFILES: CompanionProfile[] = [];
