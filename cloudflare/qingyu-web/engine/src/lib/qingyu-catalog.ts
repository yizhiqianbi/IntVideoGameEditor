import type { Character } from "./dzmm-characters";
import { shiyu } from "./qingyu-cards/shiyu";
import { shen } from "./qingyu-cards/shen";
import { linchuan } from "./qingyu-cards/linchuan";
import { xingcheng } from "./qingyu-cards/xingcheng";

export const QINGYU_CARD_VERSION = "2026-10-24-cast-v2";
// Stable IDs preserve favorites and existing conversations; their opening snapshots remain intact.
export const QINGYU_CHARACTERS: Character[] = [shiyu, shen, linchuan, xingcheng];
