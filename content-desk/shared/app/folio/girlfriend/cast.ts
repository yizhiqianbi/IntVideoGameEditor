import type { CompanionStyle } from "./companion-style";

/** Relationship cast. Display names follow the community cards. Route ids stay put. */
export type GirlfriendCast = {
  id: "qiaowan" | "tangtang" | "peiwan";
  name: string;
  line: string;
  cover: string;
  situation: string;
  description: string;
  emptyTitle: string;
  emptyDetail: string;
  placeholder: string;
  lines: readonly [string, string];
  style: CompanionStyle;
};

export const GIRLFRIEND_CAST: GirlfriendCast[] = [];

export const GIRLFRIEND_CAST_IDS = GIRLFRIEND_CAST.map(person => person.id);

export function girlfriendCastById(id: string): GirlfriendCast | null {
  return GIRLFRIEND_CAST.find(person => person.id === id) ?? null;
}
