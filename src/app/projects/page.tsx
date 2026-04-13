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
        {/* ── Page Header ── */}
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>
            <h1>我的项目</h1>
            {!isLoading && (
              <span className={styles.countBadge}>{projects.length}</span>
            )}
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => importRef.current?.click()}
            >
              导入项目包
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleCreateProject()}
              disabled={isCreating}
            >
              {isCreating ? "创建中..." : "+ 新建项目"}
            </button>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        {!isLoading && projects.length > 0 && (
          <div className={styles.statsBar}>
            <div className={styles.statItem}>
              <strong className={styles.statValue}>{projects.length}</strong>
              <span className={styles.statLabel}>项目数</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <strong className={styles.statValue}>{totalNodeCount}</strong>
              <span className={styles.statLabel}>剧情节点</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <strong className={styles.statValue}>{totalCharacterCount}</strong>
              <span className={styles.statLabel}>角色</span>
            </div>
          </div>
        )}

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
            {/* ── Featured (最近使用) ── */}
            <div className={styles.sectionLabel}>最近使用</div>
            <article className={styles.projectCardFeatured}>
              <div className={styles.coverWrap}>
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
                    <span className={styles.coverPlaceholderIcon}>🎮</span>
                  </div>
                )}
                <div className={styles.coverOverlay}>
                  <button
                    type="button"
                    className={styles.overlayBtn}
                    onClick={() => handleOpenProject(featuredProject.id)}
                  >
                    继续创作
                  </button>
                  {renamingProjectId !== featuredProject.id && (
                    <button
                      type="button"
                      className={styles.overlayBtnSecondary}
                      onClick={() => startRenamingProject(featuredProject)}
                    >
                      重命名
                    </button>
                  )}
                </div>
              </div>

              <div className={styles.projectBody}>
                <div className={styles.projectMeta}>
                  <h3 className={styles.projectName}>{featuredProject.name}</h3>
                  <span className={styles.projectDate}>
                    {formatRelativeTime(featuredProject.lastOpenedAt)}
                  </span>
                </div>
                <p className={styles.projectDesc}>
                  {featuredProject.description || "暂无说明"}
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

                {renamingProjectId === featuredProject.id ? (
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
                    </div>
                  </div>
                ) : confirmDeleteId === featuredProject.id ? (
                  <div className={styles.cardFooter}>
                    <span className={styles.confirmLabel}>确认删除？</span>
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
                ) : (
                  <div className={styles.cardFooter}>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => setConfirmDeleteId(featuredProject.id)}
                    >
                      删除项目
                    </button>
                  </div>
                )}
              </div>
            </article>

            {/* ── All Projects ── */}
            {projects.length > 1 && (
              <>
                <div className={styles.sectionLabel}>全部项目</div>
                <div className={styles.projectGrid}>
                  {projects.slice(1).map((project) => (
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
                            <span className={styles.coverPlaceholderIcon}>🎮</span>
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
                          {project.description || "暂无说明"}
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
