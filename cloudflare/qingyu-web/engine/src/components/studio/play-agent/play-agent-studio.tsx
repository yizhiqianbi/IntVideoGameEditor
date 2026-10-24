"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./play-agent-studio.module.css";
import { TopNav } from "@/components/top-nav";
import { loadProject } from "@/lib/projects";
import {
  applyPlayAgentArtifacts,
  createPlayAgentSession,
  generatePlayAgentPlan,
  getPlayAgentSession,
  listPlayAgentEvents,
  runPlayAgent,
} from "@/lib/api/play-agent";
import {
  listPlayAgentSkills,
  listPlayAgentTemplates,
} from "@/lib/play-agent";
import { listProjectPlayDrafts, saveProjectPlayDraft, type PlayAgentProjectDraftRecord } from "@/lib/play-agent/project-drafts";
import type { PlayAgentArtifactBundle, PlayAgentEvent, PlayAgentPlan } from "@/lib/play-agent/types";

type Notice = {
  tone: "info" | "error";
  message: string;
} | null;

const templates = listPlayAgentTemplates();
const skills = listPlayAgentSkills();

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function PlayAgentStudio({ projectId }: { projectId: string }) {
  const [projectName, setProjectName] = useState("当前项目");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>(
    templates[0]?.id ?? "single-screen-arcade",
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([
    "funx-instant-arcade",
    "funx-cover-director",
  ]);
  const [prompt, setPrompt] = useState(
    "做一个 20-40 秒内结束、易传播、适合首页封面流的 H5 小游戏。",
  );
  const [notice, setNotice] = useState<Notice>(null);
  const [plan, setPlan] = useState<PlayAgentPlan | null>(null);
  const [bundle, setBundle] = useState<PlayAgentArtifactBundle | null>(null);
  const [events, setEvents] = useState<PlayAgentEvent[]>([]);
  const [drafts, setDrafts] = useState<PlayAgentProjectDraftRecord[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId) ?? null,
    [templateId],
  );

  useEffect(() => {
    let cancelled = false;

    void loadProject(projectId)
      .then((loaded) => {
        if (!cancelled) {
          setProjectName(loaded.record.name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectName("当前项目");
        }
      });

    setDrafts(listProjectPlayDrafts(projectId));

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function toggleSkill(skillId: string) {
    setSelectedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((item) => item !== skillId)
        : [...current, skillId],
    );
  }

  async function ensureSession() {
    if (sessionId) {
      return sessionId;
    }

    const created = await createPlayAgentSession({
      projectId,
      templateId,
      skillIds: selectedSkillIds,
      prompt,
    });

    if (!created.ok || !created.data) {
      throw new Error(created.error ?? "创建 Play Agent 会话失败。");
    }

    setSessionId(created.data.id);
    return created.data.id;
  }

  async function refreshSessionArtifacts(nextSessionId: string) {
    const [sessionResult, eventsResult] = await Promise.all([
      getPlayAgentSession(nextSessionId),
      listPlayAgentEvents(nextSessionId),
    ]);

    if (sessionResult.ok && sessionResult.data?.plan) {
      setPlan(sessionResult.data.plan);
    }

    if (eventsResult.ok && eventsResult.data) {
      setEvents(eventsResult.data as PlayAgentEvent[]);
    }
  }

  async function handleGeneratePlan() {
    setIsPlanning(true);
    setNotice(null);

    try {
      const nextSessionId = await ensureSession();
      const result = await generatePlayAgentPlan(nextSessionId, {
        templateId,
        skillIds: selectedSkillIds,
        prompt,
      });

      if (!result.ok || !result.data) {
        throw new Error(result.error ?? "生成计划失败。");
      }

      setPlan(result.data);
      setBundle(null);
      await refreshSessionArtifacts(nextSessionId);
      setNotice({
        tone: "info",
        message: "Play 游戏计划已生成。",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "生成计划失败。",
      });
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleRunAgent() {
    setIsRunning(true);
    setNotice(null);

    try {
      const nextSessionId = await ensureSession();

      if (!plan) {
        const planResult = await generatePlayAgentPlan(nextSessionId, {
          templateId,
          skillIds: selectedSkillIds,
          prompt,
        });

        if (!planResult.ok || !planResult.data) {
          throw new Error(planResult.error ?? "生成计划失败。");
        }

        setPlan(planResult.data);
      }

      const result = await runPlayAgent(nextSessionId);

      if (!result.ok || !result.data) {
        throw new Error(result.error ?? "执行 Play Agent 失败。");
      }

      setBundle(result.data);
      await refreshSessionArtifacts(nextSessionId);
      setNotice({
        tone: "info",
        message: "Play Agent 产物已生成。",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "执行 Play Agent 失败。",
      });
    } finally {
      setIsRunning(false);
    }
  }

  async function handleApplyToProject() {
    if (!sessionId) {
      setNotice({
        tone: "error",
        message: "当前还没有可应用的会话。",
      });
      return;
    }

    setIsApplying(true);
    setNotice(null);

    try {
      const result = await applyPlayAgentArtifacts(sessionId);

      if (!result.ok || !result.data) {
        throw new Error(result.error ?? "应用 Play Agent 产物失败。");
      }

      saveProjectPlayDraft(result.data);
      setDrafts(listProjectPlayDrafts(projectId));
      setNotice({
        tone: "info",
        message: "已将 Play 草案写入当前项目。",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "写入当前项目失败。",
      });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <main className={styles.page}>
      <TopNav />

      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Play Create</span>
            <h1 className={styles.title}>Web 游戏创作 Agent</h1>
            <p className={styles.subtitle}>
              当前项目：<strong>{projectName}</strong>
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href={`/pencil-studio-vid?project=${projectId}`} className={styles.secondaryLink}>
              返回互动编辑器
            </Link>
            <Link href="/projects" className={styles.secondaryLink}>
              项目库
            </Link>
          </div>
        </header>

        {notice ? (
          <div className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : styles.noticeInfo}`}>
            {notice.message}
          </div>
        ) : null}

        <div className={styles.layout}>
          <section className={styles.configPanel}>
            <div className={styles.panelHeader}>
              <h2>创作输入</h2>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>模板</span>
              <div className={styles.optionGrid}>
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`${styles.optionButton} ${template.id === templateId ? styles.optionButtonActive : ""}`}
                    onClick={() => setTemplateId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.category}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Skills</span>
              <div className={styles.chipWrap}>
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    className={`${styles.chip} ${selectedSkillIds.includes(skill.id) ? styles.chipActive : ""}`}
                    onClick={() => toggleSkill(skill.id)}
                  >
                    {skill.name}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Prompt</span>
              <textarea
                className={styles.textarea}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述你想做的 H5 小游戏。"
              />
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleGeneratePlan()}
                disabled={isPlanning}
              >
                {isPlanning ? "生成中..." : "生成计划"}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleRunAgent()}
                disabled={isRunning}
              >
                {isRunning ? "执行中..." : "运行 Agent"}
              </button>
            </div>
          </section>

          <section className={styles.outputPanel}>
            <div className={styles.panelHeader}>
              <h2>计划与产物</h2>
              <button
                type="button"
                className={styles.applyButton}
                onClick={() => void handleApplyToProject()}
                disabled={!bundle || isApplying}
              >
                {isApplying ? "写入中..." : "应用到项目"}
              </button>
            </div>

            {selectedTemplate ? (
              <div className={styles.templateIntro}>
                <strong>{selectedTemplate.name}</strong>
                <p>{selectedTemplate.starterPrompt}</p>
              </div>
            ) : null}

            {plan ? (
              <div className={styles.planCard}>
                <h3>{plan.concept}</h3>
                <ul className={styles.planList}>
                  <li>循环：{plan.loop}</li>
                  <li>胜利：{plan.winCondition}</li>
                  <li>失败：{plan.failCondition}</li>
                  {plan.progression ? <li>进度：{plan.progression}</li> : null}
                </ul>
              </div>
            ) : (
              <div className={styles.emptyState}>先生成一个 Play 计划。</div>
            )}

            {bundle ? (
              <>
                <div className={styles.filesCard}>
                  <h3>生成文件</h3>
                  <div className={styles.fileList}>
                    {bundle.files.map((file) => (
                      <article key={file.path} className={styles.fileItem}>
                        <header>
                          <strong>{file.path}</strong>
                        </header>
                        <pre>{file.content}</pre>
                      </article>
                    ))}
                  </div>
                </div>

                {bundle.coverPrompt ? (
                  <div className={styles.coverCard}>
                    <h3>封面提示词</h3>
                    <p>{bundle.coverPrompt}</p>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className={styles.eventCard}>
              <h3>执行事件</h3>
              {events.length > 0 ? (
                <ul className={styles.eventList}>
                  {events.map((event, index) => (
                    <li key={`${event.timestamp}-${index}`}>
                      <span>{event.message}</span>
                      <time>{formatDate(event.timestamp)}</time>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.emptyInline}>还没有事件。</div>
              )}
            </div>
          </section>

          <aside className={styles.draftsPanel}>
            <div className={styles.panelHeader}>
              <h2>项目内 Play 草案</h2>
            </div>
            {drafts.length > 0 ? (
              <div className={styles.draftList}>
                {drafts.map((draft) => (
                  <article key={draft.id} className={styles.draftCard}>
                    <strong>{draft.name}</strong>
                    <span>{draft.bundle.plan.loop}</span>
                    <div className={styles.draftMeta}>
                      <span>{draft.skillIds.length} 个 skill</span>
                      <time>{formatDate(draft.updatedAt)}</time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>应用到项目后，这里会保留当前项目的 Play 草案。</div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
