import { QINGYU_CHARACTERS } from "../../../src/lib/qingyu-catalog";
export type CharacterShareRecord={id:string;title:string;description:string};
export const CHARACTER_SHARE_INDEX:CharacterShareRecord[]=QINGYU_CHARACTERS.map(c=>({id:c.id,title:`${c.name} · 晴屿`,description:c.introduction || c.description}));
