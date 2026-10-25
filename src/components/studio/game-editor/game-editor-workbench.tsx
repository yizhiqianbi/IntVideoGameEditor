"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "./game-editor-workbench.module.css";
import { TextChoicePreview } from "./previews/text-choice-preview";
import { ClickReactionPreview } from "./previews/click-reaction-preview";
import { MemoryPreview } from "./previews/memory-preview";
import { GenericPreview } from "./previews/generic-preview";

type GameType =
  | "text-choice"
  | "click-reaction"
  | "memory"
  | "physics"
  | "puzzle"
  | "rhythm";

type Choice = { label: string; consequence: string };
type Chapter = { age: string; title: string; prompt: string; choices: [Choice, Choice] };

type GameConfig = {
  title: string;
  description: string;
  duration: number;
  chapters: Chapter[];
  targetScore: number;
};

type ChatMessage = {
  role: "agent" | "user";
  body: string;
  suggestions?: { label: string; patch: Partial<GameConfig> }[];
};

type DeviceMode = "mobile" | "tablet" | "desktop";

const TYPE_META: Record<GameType, { cn: string; en: string; icon: string }> = {
  "text-choice": { cn: "文字选择", en: "Text Choice", icon: "📖" },
  "click-reaction": { cn: "点击反应", en: "Click Reaction", icon: "⚡" },
  memory: { cn: "记忆对标", en: "Memory Match", icon: "🧠" },
  physics: { cn: "物理模拟", en: "Physics", icon: "💫" },
  puzzle: { cn: "谜题益智", en: "Puzzle", icon: "🎲" },
  rhythm: { cn: "节奏时序", en: "Rhythm", icon: "🎵" },
};

const INITIAL_CONFIG: GameConfig = {
  title: "富豪人生路",
  description: "从童年到巅峰，每个选择决定你的命运曲线。",
  duration: 180,
  targetScore: 100,
  chapters: [
    {
      age: "5 岁",
      title: "童年起点",
      prompt: "家里又搬家了。你是先去观察新环境，还是先把自己缩回安全角落？",
      choices: [
        { label: "先去观察和提问", consequence: "你更早学会了看局势。" },
        { label: "先躲回熟悉规则里", consequence: "你学会了谨慎。" },
      ],
    },
    {
      age: "16 岁",
      title: "异国打工",
      prompt: "白天上学、晚上打工，只能保一头。选稳的收入，还是难的技能？",
      choices: [
        { label: "多打一份工，先把现金流稳住", consequence: "你学会了承压。" },
        { label: "少赚一点，换技能和视野", consequence: "你摸到改变命运的杠杆。" },
      ],
    },
  ],
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: "agent",
    body: "我是你的游戏创作助手。告诉我你想做什么样的小游戏，我来帮你搭骨架。你也可以直接在右边调参数。",
    suggestions: [
      { label: "✨ 让节奏更紧凑", patch: { duration: 120 } },
      { label: "📈 提高挑战", patch: { targetScore: 150 } },
    ],
  },
];

const QUICK_PROMPTS = [
  "再加一章（18 岁高考选择）",
  "把文案改得更戏剧化",
  "改成 60 秒速通版",
  "加个反派角色",
];

export function GameEditorWorkbench({ gameType }: { gameType: GameType }) {
  const [config, setConfig] = useState<GameConfig>(INITIAL_CONFIG);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [device, setDevice] = useState<DeviceMode>("mobile");
  const [rightTab, setRightTab] = useState<"meta" | "chapters">("meta");
  const [previewKey, setPreviewKey] = useState(0);

  const meta = TYPE_META[gameType];

  function applyPatch(patch: Partial<GameConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
    setPreviewKey((k) => k + 1);
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    const userMsg: ChatMessage = { role: "user", body: text };
    const agentMsg: ChatMessage = {
      role: "agent",
      body: `收到「${text}」。我根据你的想法调整了一下配置 — 你可以在右侧看到变化，也可以继续微调。`,
      suggestions: [
        { label: "🎯 再收紧一点", patch: { duration: Math.max(60, config.duration - 30) } },
        { label: "📖 加一章", patch: { chapters: [...config.chapters, makeEmptyChapter()] } },
      ],
    };
    setMessages((m) => [...m, userMsg, agentMsg]);
    setDraft("");
  }

  function updateChapter(idx: number, patch: Partial<Chapter>) {
    setConfig((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
    setPreviewKey((k) => k + 1);
  }

  function updateChoice(chapterIdx: number, choiceIdx: 0 | 1, patch: Partial<Choice>) {
    setConfig((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c, i) => {
        if (i !== chapterIdx) return c;
        const nextChoices = [...c.choices] as [Choice, Choice];
        nextChoices[choiceIdx] = { ...nextChoices[choiceIdx], ...patch };
        return { ...c, choices: nextChoices };
      }),
    }));
    setPreviewKey((k) => k + 1);
  }

  function addChapter() {
    setConfig((prev) => ({ ...prev, chapters: [...prev.chapters, makeEmptyChapter()] }));
    setPreviewKey((k) => k + 1);
  }

  function removeChapter(idx: number) {
    setConfig((prev) => ({
      ...prev,
      chapters: prev.chapters.filter((_, i) => i !== idx),
    }));
    setPreviewKey((k) => k + 1);
  }

  return (
    <div className={styles.workbench}>
      {/* ── Top bar ───────────────────────── */}
      <header className={styles.topBar}>
        <Link href="/studio/games/create" className={styles.brand}>
          <span className={styles.brandMark}>G</span>
          <span>Game Studio</span>
        </Link>
        <div className={styles.titleBlock}>
          <span className={styles.slash}>/</span>
          <input
            className={styles.titleInput}
            value={config.title}
            onChange={(e) => applyPatch({ title: e.target.value })}
            placeholder="未命名作品"
          />
          <span className={styles.typeTag}>
            {meta.icon} {meta.en}
          </span>
        </div>
        <div className={styles.topActions}>
          <button className={styles.ghostBtn} type="button">
            预览
          </button>
          <button className={styles.ghostBtn} type="button">
            存草稿
          </button>
          <button className={styles.primaryBtn} type="button">
            发布上线
          </button>
        </div>
      </header>

      {/* ── 3-pane layout ─────────────────── */}
      <div className={styles.panes}>
        {/* Left: AI chat */}
        <aside className={styles.pane}>
          <div className={styles.paneHead}>
            <h3 className={styles.paneTitle}>AI 助手</h3>
            <span className={styles.paneBadge}>
              <span className={styles.pulseDot} /> 在线
            </span>
          </div>
          <div className={styles.chatBody}>
            <div className={styles.chatMessages}>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`${styles.msg} ${
                    msg.role === "agent" ? styles.msgAgent : styles.msgUser
                  }`}
                >
                  <div className={styles.msgHead}>
                    <span className={styles.msgAvatar}>
                      {msg.role === "agent" ? "A" : "你"}
                    </span>
                    <span>{msg.role === "agent" ? "助手" : "你"}</span>
                  </div>
                  <div className={styles.msgBody}>{msg.body}</div>
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className={styles.msgActions}>
                      {msg.suggestions.map((s, j) => (
                        <button
                          key={j}
                          className={styles.msgAction}
                          onClick={() => applyPatch(s.patch)}
                          type="button"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <form className={styles.chatInput} onSubmit={handleSend}>
              <div className={styles.chatBox}>
                <textarea
                  className={styles.chatTextarea}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="告诉助手你想调整什么，例如：把结局改得更意外..."
                  rows={2}
                />
                <button
                  type="submit"
                  className={styles.sendBtn}
                  disabled={!draft.trim()}
                  aria-label="发送"
                >
                  ↑
                </button>
              </div>
              <div className={styles.quickPrompts}>
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={styles.quickPrompt}
                    onClick={() => setDraft(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </aside>

        {/* Center: preview */}
        <section className={`${styles.pane} ${styles.previewPane}`}>
          <div className={styles.previewHead}>
            <h3 className={styles.paneTitle}>实时预览</h3>
            <div className={styles.deviceToggle}>
              {(["mobile", "tablet", "desktop"] as DeviceMode[]).map((d) => (
                <button
                  key={d}
                  className={`${styles.deviceBtn} ${device === d ? styles.active : ""}`}
                  onClick={() => setDevice(d)}
                  type="button"
                >
                  {d === "mobile" ? "📱 手机" : d === "tablet" ? "平板" : "🖥 桌面"}
                </button>
              ))}
            </div>
            <button
              className={styles.reloadBtn}
              onClick={() => setPreviewKey((k) => k + 1)}
              type="button"
              aria-label="重新加载预览"
            >
              ⟳
            </button>
          </div>
          <div className={styles.previewStage}>
            <div className={`${styles.deviceFrame} ${styles[device]}`}>
              <div className={styles.previewInner} key={previewKey}>
                {gameType === "text-choice" && <TextChoicePreview config={config} />}
                {gameType === "click-reaction" && <ClickReactionPreview config={config} />}
                {gameType === "memory" && <MemoryPreview config={config} />}
                {gameType !== "text-choice" &&
                  gameType !== "click-reaction" &&
                  gameType !== "memory" && <GenericPreview meta={meta} config={config} />}
              </div>
            </div>
          </div>
        </section>

        {/* Right: params */}
        <aside className={`${styles.pane} ${styles.paramsPane}`}>
          <div className={styles.paneHead}>
            <h3 className={styles.paneTitle}>参数</h3>
          </div>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${rightTab === "meta" ? styles.active : ""}`}
              onClick={() => setRightTab("meta")}
              type="button"
            >
              基本信息
            </button>
            <button
              className={`${styles.tab} ${rightTab === "chapters" ? styles.active : ""}`}
              onClick={() => setRightTab("chapters")}
              type="button"
            >
              {gameType === "text-choice" ? "章节" : "关卡"}
              <span style={{ marginLeft: 4, opacity: 0.6 }}>({config.chapters.length})</span>
            </button>
          </div>
          <div className={styles.paramsBody}>
            {rightTab === "meta" && (
              <>
                <div className={styles.paramSection}>
                  <h4 className={styles.paramSectionTitle}>基础</h4>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>游戏名</label>
                    <input
                      className={styles.input}
                      value={config.title}
                      onChange={(e) => applyPatch({ title: e.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>简介</label>
                    <textarea
                      className={styles.textarea}
                      value={config.description}
                      onChange={(e) => applyPatch({ description: e.target.value })}
                    />
                  </div>
                </div>
                <div className={styles.paramSection}>
                  <h4 className={styles.paramSectionTitle}>节奏</h4>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>目标时长（秒）</label>
                    <input
                      type="number"
                      className={styles.input}
                      value={config.duration}
                      onChange={(e) =>
                        applyPatch({ duration: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>通关分数</label>
                    <input
                      type="number"
                      className={styles.input}
                      value={config.targetScore}
                      onChange={(e) =>
                        applyPatch({ targetScore: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>
              </>
            )}

            {rightTab === "chapters" && (
              <div className={styles.paramSection}>
                {config.chapters.map((chapter, i) => (
                  <div key={i} className={styles.chapterCard}>
                    <div className={styles.chapterHead}>
                      <span className={styles.chapterIdx}>CHAPTER {i + 1}</span>
                      <button
                        type="button"
                        className={styles.chapterDel}
                        onClick={() => removeChapter(i)}
                        aria-label="删除章节"
                      >
                        ✕
                      </button>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>阶段</label>
                      <input
                        className={styles.input}
                        value={chapter.age}
                        onChange={(e) => updateChapter(i, { age: e.target.value })}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>标题</label>
                      <input
                        className={styles.input}
                        value={chapter.title}
                        onChange={(e) => updateChapter(i, { title: e.target.value })}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>场景提问</label>
                      <textarea
                        className={styles.textarea}
                        value={chapter.prompt}
                        onChange={(e) => updateChapter(i, { prompt: e.target.value })}
                      />
                    </div>
                    {chapter.choices.map((choice, ci) => (
                      <div key={ci} className={styles.choiceRow}>
                        <span className={styles.choiceMark}>{ci === 0 ? "A" : "B"}</span>
                        <div className={styles.choiceFields}>
                          <input
                            className={styles.input}
                            value={choice.label}
                            onChange={(e) =>
                              updateChoice(i, ci as 0 | 1, { label: e.target.value })
                            }
                            placeholder="选项文案"
                          />
                          <input
                            className={styles.input}
                            value={choice.consequence}
                            onChange={(e) =>
                              updateChoice(i, ci as 0 | 1, { consequence: e.target.value })
                            }
                            placeholder="后果描述"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <button type="button" className={styles.addBtn} onClick={addChapter}>
                  + 添加章节
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function makeEmptyChapter(): Chapter {
  return {
    age: "新阶段",
    title: "新章节",
    prompt: "在这里写下你的场景描述和抉择...",
    choices: [
      { label: "选项 A", consequence: "A 的后果" },
      { label: "选项 B", consequence: "B 的后果" },
    ],
  };
}

export type { GameConfig, Chapter, Choice, GameType };
