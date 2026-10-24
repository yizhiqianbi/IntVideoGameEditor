"use client";

import { deriveXumengCharacterStatus } from "../../lib/xumeng-character-status";
import type { DzmmStoryState } from "../../lib/dzmm-story-memory";
import type { DzmmSavedMessage } from "../../lib/dzmm-storage";
import type { DzmmWorldClockMode, DzmmWorldState } from "../../lib/dzmm-world-state";
import type { Character } from "../../lib/dzmm-characters";
import styles from "./xumeng-character-status-panel.module.css";

type Props = {
  character: Character;
  world?: DzmmWorldState;
  clockMode?: DzmmWorldClockMode;
  memory?: DzmmStoryState;
  messages: readonly DzmmSavedMessage[];
  now: number;
};

export default function XumengCharacterStatusPanel({ character, world, clockMode, memory, messages, now }: Props) {
  const status = deriveXumengCharacterStatus({ character, world, clockMode, memory, messages, now });
  return <details className={styles.panel} aria-label="角色状态">
    <summary className={styles.header}>
      <div><span className={styles.eyebrow}>这一刻</span><strong>{status.characterName}</strong></div>
      <span className={styles.mode}>{status.modeLabel} · 展开状态</span>
    </summary>
    <dl className={styles.grid}>
      <div><dt>时间</dt><dd>{status.timeLabel}{status.dayLabel && <small>{status.dayLabel}</small>}</dd></div>
      <div><dt>{status.mode === "companion" ? "正在做" : "活动"}</dt><dd>{status.activity}</dd></div>
      <div><dt>地点</dt><dd>{status.location}</dd></div>
      <div><dt>场景</dt><dd>{status.scene}</dd></div>
      <div><dt>人物</dt><dd>{status.people.join("、") || "未记录"}</dd></div>
      <div><dt>事件</dt><dd>{status.event}</dd></div>
    </dl>
    {status.mode === "companion" && <p className={styles.basis}>{status.occupation ? `职业：${status.occupation} · 按当前时间和周历推导日常安排` : "尚未从角色卡识别到职业，日程保持保守"}</p>}
    
  </details>;
}
