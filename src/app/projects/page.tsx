"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { TopNav } from "@/components/top-nav";
import {
  deleteProject,
  listProjects,
  renameProject,
  saveProject,
  type ProjectSummary,
} from "@/lib/projects";
import { importProjectPackage } from "@/lib/project-package";
import { setStoredActiveProjectId } from "@/lib/project-session";
import {
  createVideoSceneNode,
  parseProject,
  serializeProject,
} from "@/components/editor/project";
import { collectProjectReferencedAssetIds } from "@/lib/project-templates";
import { DEFAULT_PROVIDER_PRIORITY } from "@/lib/video-generation";

type Notice = {
  tone: "info" | "error";
  message: string;
} | null;

function createBlankSnapshot(title: string) {
  return serializeProject(
    [
      createVideoSceneNode(
        { x: 80, y: 120 },
        {
          title,
        },
      ),
    ],
    [],
    [],
    [],
    {
      providerPriority: [...DEFAULT_PROVIDER_PRIORITY],
    },
  );
}

function formatRelativeTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ProjectsPage() {
  const router = useRouter();
  const importRef = useRef<HTMLInputElement | null>(null);
  const shouldAutoCreateRef = useRef(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [renamingDescription, setRenamingDescription] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const noticeDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalNodeCount = useMemo(
    () => projects.reduce((total, project) => total + project.stats.nodeCount, 0),
    [projects],
  );
  const totalCharacterCount = useMemo(
    () => projects.reduce((total, project) => total + project.stats.characterCount, 0),
    [projects],
  );
  const featuredProject = projects[0] ?? null;
  const queuedProjects = useMemo(() => projects.slice(1, 4), [projects]);

  function showNotice(next: Notice) {
    if (noticeDismissRef.current) clearTimeout(noticeDismissRef.current);
    setNotice(next);
    if (next) {
      noticeDismissRef.current = setTimeout(() => showNotice(null), 4000);
    }
  }

  async function refreshProjects() {
    setIsLoading(true);

    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
    } catch (error) {
      showNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "读取项目库失败。",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      shouldAutoCreateRef.current =
        new URLSearchParams(window.location.search).get("new") === "1";
    }

    void refreshProjects();
  }, []);

  // ?new=1 — triggered from TopNav CTA button
  useEffect(() => {
    if (shouldAutoCreateRef.current && !isLoading && !isCreating) {
      shouldAutoCreateRef.current = false;
      void handleCreateProject();
      router.replace("/projects", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreateProject() {
    setIsCreating(true);

    try {
      const createdAt = new Date();
      const projectName = `未命名项目 ${createdAt.toLocaleDateString("zh-CN")}`;
      const snapshot = createBlankSnapshot("开场镜头");
      const record = await saveProject({
        name: projectName,
        description: "一个新的互动影游戏项目",
        snapshot,
        referencedAssetIds: [],
        media: [],
      });

      setStoredActiveProjectId(record.id);
      router.push(`/pencil-studio-vid?project=${record.id}`);
    } catch (error) {
      showNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "创建项目失败。",
      });
    } finally {
      setIsCreating(false);
    }
  }

  function handleOpenProject(projectId: string) {
    setStoredActiveProjectId(projectId);
    router.push(`/pencil-studio-vid?project=${projectId}`);
  }

  async function handleDeleteProject(projectId: string) {
    setConfirmDeleteId(null);
    try {
      await deleteProject(projectId);
      if (renamingProjectId === projectId) {
        setRenamingProjectId(null);
      }
      await refreshProjects();
      showNotice({
        tone: "info",
        message: "项目已删除。",
      });
    } catch (error) {
      showNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "删除项目失败。",
      });
    }
  }

  function startRenamingProject(project: ProjectSummary) {
    setRenamingProjectId(project.id);
    setRenamingName(project.name);
    setRenamingDescription(project.description);
  }

  async function submitProjectRename(projectId: string) {
    const trimmedName = renamingName.trim();

    if (!trimmedName) {
      showNotice({
        tone: "error",
        message: "项目名称不能为空。",
      });
      return;
    }

    try {
      await renameProject(projectId, {
        name: trimmedName,
        description: renamingDescription.trim(),
      });
      setRenamingProjectId(null);
      setRenamingName("");
      setRenamingDescription("");
      await refreshProjects();
      showNotice({
        tone: "info",
        message: "项目信息已更新。",
      });
    } catch (error) {
      showNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "更新项目信息失败。",
      });
    }
  }

  async function handleImportPackage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const imported =
        file.name.endsWith(".zip") || file.type === "application/zip"
          ? await importProjectPackage(file)
          : {
              name: file.name.replace(/\.json$/i, ""),
              description: "从旧工程 JSON 导入",
              previewImageUrl: undefined,
              snapshot: parseProject(JSON.parse(await file.text())),
              media: [],
            };
      const saved = await saveProject({
        name: imported.name,
        description: imported.description,
        previewImageUrl: imported.previewImageUrl,
        snapshot: imported.snapshot,
        referencedAssetIds: collectProjectReferencedAssetIds(imported.snapshot),
        media: imported.media,
      });

      setStoredActiveProjectId(saved.id);
      router.push(`/pencil-studio-vid?project=${saved.id}`);
    } catch (error) {
      showNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "导入项目包失败，请检查文件格式。",
      });
    }
  }

  return (
    <main className={styles.page}>
      <TopNav />

      <div className={styles.shell}>
        <section className={styles.libraryHero}>
          <div className={styles.libraryIntro}>
            <span className={styles.libraryEyebrow}>Project Library</span>
            <div className={styles.pageTitle}>
              <h1>我的项目</h1>
              {!isLoading && (
                <span className={styles.countBadge}>{projects.length}</span>
              )}
            </div>
            <p className={styles.librarySubtitle}>
              继续最近作品，或者直接开始一个新的互动影游项目。
            </p>
            <div className={styles.heroActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleCreateProject()}
                disabled={isCreating}
              >
                {isCreating ? "创建中..." : "新建项目"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => importRef.current?.click()}
              >
                导入项目包
              </button>
            </div>
            <div className={styles.heroFacts}>
              <span>{projects.length} 个项目</span>
              <span>{totalNodeCount} 个节点</span>
              <span>{totalCharacterCount} 个角色</span>
            </div>
          </div>

          {featuredProject ? (
            <article className={styles.recentProjectCard}>
              <div className={styles.recentProjectVisual}>
                {featuredProject.previewImageUrl ? (
                  <Image
                    className={styles.cover}
                    src={featuredProject.previewImageUrl}
                    alt={featuredProject.name}
                    width={960}
                    height={540}
                    unoptimized
                  />
                ) : (
                  <div className={styles.coverPlaceholder}>
                    <span className={styles.coverPlaceholderIcon}>▶</span>
                  </div>
                )}
              </div>
              <div className={styles.recentProjectBody}>
                <div className={styles.recentProjectMeta}>
                  <span className={styles.recentProjectKicker}>最近编辑</span>
                  <span className={styles.projectDate}>
                    {formatRelativeTime(featuredProject.lastOpenedAt)}
                  </span>
                </div>
                <h2 className={styles.recentProjectTitle}>{featuredProject.name}</h2>
                <p className={styles.recentProjectDesc}>
                  {featuredProject.description || "继续从这里推进你的互动影游。"}
                </p>
                <div className={styles.metaChips}>
                  <span className={styles.metaChip}>
                    {featuredProject.stats.nodeCount} 节点
                  </span>
                  <span className={styles.metaChip}>
                    {featuredProject.stats.sceneCount} 场景
                  </span>
                  <span className={styles.metaChip}>
                    {featuredProject.stats.characterCount} 角色
                  </span>
                  <span className={styles.metaChip}>
                    {featuredProject.stats.branchCount} 分支
                  </span>
                </div>
                {queuedProjects.length > 0 ? (
                  <div className={styles.recentProjectQueue}>
                    <span className={styles.queueLabel}>继续其他项目</span>
                    <div className={styles.queueList}>
                      {queuedProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={styles.queueItem}
                          onClick={() => handleOpenProject(project.id)}
                        >
                          <span className={styles.queueItemName}>{project.name}</span>
                          <span className={styles.queueItemMeta}>
                            {project.stats.nodeCount} 节点
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className={styles.recentProjectFooter}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => handleOpenProject(featuredProject.id)}
                  >
                    继续创作
                  </button>
                  {renamingProjectId !== featuredProject.id ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => startRenamingProject(featuredProject)}
                    >
                      重命名
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ) : (
            <div className={styles.recentProjectCardEmpty}>
              <span className={styles.recentProjectKicker}>准备开始</span>
              <h2 className={styles.recentProjectTitle}>从一个新项目开始</h2>
              <p className={styles.recentProjectDesc}>
                创建项目后，你的角色、场景、节点和素材都会持续保存在当前浏览器。
              </p>
            </div>
          )}
        </section>

        {/* ── Notice ── */}
        {notice ? (
          <div
            className={`${styles.notice} ${
              notice.tone === "error" ? styles.noticeError : styles.noticeInfo
            }`}
          >
            {notice.message}
          </div>
        ) : null}

        {/* ── Content ── */}
        {isLoading ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>⏳</div>
            <p className={styles.emptyTitle}>正在读取项目库...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎬</div>
            <p className={styles.emptyTitle}>还没有项目</p>
            <p className={styles.emptySubtitle}>
              新建一个项目或导入已有项目包开始创作
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleCreateProject()}
              disabled={isCreating}
            >
              {isCreating ? "创建中..." : "+ 新建项目"}
            </button>
          </div>
        ) : (
          <>
            {renamingProjectId === featuredProject?.id ? (
              <section className={styles.renameCard}>
                <div className={styles.inlineHeader}>
                  <h2 className={styles.sectionTitle}>编辑最近项目</h2>
                  <span className={styles.hint}>更新项目名与说明</span>
                </div>
                <div className={styles.renamePanel}>
                  <input
                    className={styles.input}
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                    placeholder="项目名称"
                  />
                  <textarea
                    className={styles.textarea}
                    value={renamingDescription}
                    onChange={(e) => setRenamingDescription(e.target.value)}
                    placeholder="一句话说明"
                  />
                  <div className={styles.renameActions}>
                    <button
                      type="button"
                      className={styles.saveButton}
                      onClick={() => void submitProjectRename(featuredProject.id)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => {
                        setRenamingProjectId(null);
                        setRenamingName("");
                        setRenamingDescription("");
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => setConfirmDeleteId(featuredProject.id)}
                    >
                      删除项目
                    </button>
                  </div>
                </div>
              </section>
            ) : confirmDeleteId === featuredProject?.id ? (
              <section className={styles.renameCard}>
                <div className={styles.inlineHeader}>
                  <h2 className={styles.sectionTitle}>删除最近项目</h2>
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.confirmLabel}>确认删除当前最近项目？</span>
                  <button
                    type="button"
                    className={styles.dangerButtonSolid}
                    onClick={() => void handleDeleteProject(featuredProject.id)}
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    取消
                  </button>
                </div>
              </section>
            ) : null}

            <div className={styles.projectGridHeader}>
              <div className={styles.pageTitle}>
                <h2>全部项目</h2>
              </div>
              <span className={styles.hint}>
                {projects.length === 1 ? "1 个项目" : `${projects.length} 个项目`}
              </span>
            </div>

            <div className={styles.projectGrid}>
              {projects
                .filter((project) => project.id !== featuredProject?.id)
                .map((project) => (
                  <article key={project.id} className={styles.projectCard}>
                    <div className={styles.coverWrap}>
                      {project.previewImageUrl ? (
                        <Image
                          className={styles.cover}
                          src={project.previewImageUrl}
                          alt={project.name}
                          width={960}
                          height={540}
                          unoptimized
                        />
                      ) : (
                        <div className={styles.coverPlaceholder}>
                          <span className={styles.coverPlaceholderIcon}>◼</span>
                        </div>
                      )}
                      <div className={styles.coverOverlay}>
                        <button
                          type="button"
                          className={styles.overlayBtn}
                          onClick={() => handleOpenProject(project.id)}
                        >
                          打开
                        </button>
                        {renamingProjectId !== project.id && (
                          <button
                            type="button"
                            className={styles.overlayBtnSecondary}
                            onClick={() => startRenamingProject(project)}
                          >
                            重命名
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={styles.projectBody}>
                      <div className={styles.projectMeta}>
                        <h3 className={styles.projectName}>{project.name}</h3>
                        <span className={styles.projectDate}>
                          {formatRelativeTime(project.lastOpenedAt)}
                        </span>
                      </div>
                      <p className={styles.projectDesc}>
                        {project.description || "继续补完这条创作线。"}
                      </p>
                      <div className={styles.metaChips}>
                        <span className={styles.metaChip}>
                          {project.stats.nodeCount} 节点
                        </span>
                        <span className={styles.metaChip}>
                          {project.stats.sceneCount} 场景
                        </span>
                        <span className={styles.metaChip}>
                          {project.stats.characterCount} 角色
                        </span>
                      </div>

                      {renamingProjectId === project.id ? (
                        <div className={styles.renamePanel}>
                          <input
                            className={styles.input}
                            value={renamingName}
                            onChange={(e) => setRenamingName(e.target.value)}
                            placeholder="项目名称"
                          />
                          <textarea
                            className={styles.textarea}
                            value={renamingDescription}
                            onChange={(e) =>
                              setRenamingDescription(e.target.value)
                            }
                            placeholder="一句话说明"
                          />
                          <div className={styles.renameActions}>
                            <button
                              type="button"
                              className={styles.saveButton}
                              onClick={() =>
                                void submitProjectRename(project.id)
                              }
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              className={styles.cancelButton}
                              onClick={() => {
                                setRenamingProjectId(null);
                                setRenamingName("");
                                setRenamingDescription("");
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : confirmDeleteId === project.id ? (
                        <div className={styles.cardFooter}>
                          <span className={styles.confirmLabel}>确认删除？</span>
                          <button
                            type="button"
                            className={styles.dangerButtonSolid}
                            onClick={() => void handleDeleteProject(project.id)}
                          >
                            确认
                          </button>
                          <button
                            type="button"
                            className={styles.cancelButton}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className={styles.cardFooter}>
                          <button
                            type="button"
                            className={styles.dangerButton}
                            onClick={() => setConfirmDeleteId(project.id)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
            </div>

            {projects.length === 1 && (
              <>
                <div className={styles.emptyMinorState}>
                  <p className={styles.hint}>当前只有最近项目这一条创作线。</p>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <input
        ref={importRef}
        className={styles.hiddenInput}
        type="file"
        accept=".zip,application/zip,application/json,.json"
        onChange={handleImportPackage}
      />
    </main>
  );
}
