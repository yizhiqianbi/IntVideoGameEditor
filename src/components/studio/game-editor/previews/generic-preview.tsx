import styles from "./preview.module.css";
import type { GameConfig } from "../game-editor-workbench";

export function GenericPreview({
  meta,
  config,
}: {
  meta: { cn: string; en: string; icon: string };
  config: GameConfig;
}) {
  return (
    <div className={styles.stage}>
      <div className={styles.genericStage}>
        <span className={styles.genericIcon}>{meta.icon}</span>
        <h2 className={styles.genericTitle}>{config.title}</h2>
        <p className={styles.genericHint}>
          {meta.cn} 模板的可视化预览正在开发中。先用 AI 助手描述玩法，然后在右侧调节参数 —
          发布后将看到完整游戏。
        </p>
      </div>
    </div>
  );
}
