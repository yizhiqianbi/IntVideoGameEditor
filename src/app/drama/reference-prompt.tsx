"use client";
import type { Shot } from "@/lib/drama";
import type { AssetCard } from "@/lib/drama-assets";
import { referenceSlots } from "@/lib/drama-mentions";
import { MentionField } from "./mention-field";
import styles from "./studio.module.css";

export function ReferencePrompt({
  shot,
  assets,
  disabled,
  value,
  onChange,
}: {
  shot: Shot;
  assets: AssetCard[];
  disabled: boolean;
  value: string;
  onChange: (p: Partial<Shot>) => void;
}) {
  return (
    <section className={styles.referenceComposer}>
      <label htmlFor="shot-prompt">
        画面（Prompt）
        <small>起始、动作、运镜、场景、声音写在同一栏；输入 @ 引用素材</small>
      </label>
      <MentionField
        id="shot-prompt"
        listId="reference-choices"
        className={styles.prompt}
        value={value}
        disabled={disabled}
        placeholder="这一镜的画面。可写成一段，或保留「起始 / 动作 / 镜头 / 场景 / 声音 / 结束」几行。"
        slots={referenceSlots(shot, assets)}
        bindings={shot.referenceBindings || {}}
        showChips
        onChange={(prompt, referenceBindings) =>
          onChange({
            prompt,
            ...(referenceBindings ? { referenceBindings } : {}),
          })
        }
      />
    </section>
  );
}
