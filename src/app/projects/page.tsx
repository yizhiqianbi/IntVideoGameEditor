"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [renamingDescription, setRenamingDescription] = useState("");

  const totalNodeCount = useMemo(
    () => projects.reduce((total, project) => total + project.stats.nodeCount, 0),
    [projects],
  );
  const featuredProject = projects[0] ?? null;

  async function refreshProjects() {
    setIsLoading(true);

    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "读取项目库失败。",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshProjects();
  }, []);

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
      setNotice({
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
    try {
      await deleteProject(projectId);
      if (renamingProjectId === projectId) {
        setRenamingProjectId(null);
      }
      await refreshProjects();
      setNotice({
        tone: "info",
        message: "项目已删除。",
      });
    } catch (error) {
      setNotice({
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
      setNotice({
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
      setNotice({
        tone: "info",
        message: "项目信息已更新。",
      });
    } catch (error) {
      setNotice({
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
      setNotice({
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
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.heroCard}>
            <div className={styles.heroTitleRow}>
              <div className={styles.heroTitleBlock}>
                <span className={styles.eyebrow}>Project Library</span>
                <h1 className={styles.title}>我的项目</h1>
              </div>
              <div className={styles.heroMetaChips}>
                <span className={styles.heroMetaChip}>本地项目</span>
                <span className={styles.heroMetaChip}>自动保存</span>
                <span className={styles.heroMetaChip}>项目包</span>
              </div>
            </div>
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
              {featuredProject ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => handleOpenProject(featuredProject.id)}
                >
                  继续最近项目
                </button>
              ) : null}
            </div>
            <input
              ref={importRef}
              className={styles.hiddenInput}
              type="file"
              accept=".zip,application/zip,application/json,.json"
              onChange={handleImportPackage}
            />
          </div>

          <aside className={styles.sideCard}>
            {featuredProject ? (
              <>
                {featuredProject.previewImageUrl ? (
                  <Image
                    className={styles.sideCover}
                    src={featuredProject.previewImageUrl}
                    alt={featuredProject.name}
                    width={960}
                    height={540}
                    unoptimized
                  />
                ) : (
                  <div className={styles.sideCoverPlaceholder}>最近项目</div>
                )}
                <div className={styles.featuredProject}>
                  <div>
                    <span className={styles.hint}>继续上次</span>
                    <strong className={styles.featuredProjectName}>
                      {featuredProject.name}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => handleOpenProject(featuredProject.id)}
                  >
                    继续创作
                  </button>
                </div>
              </>
            ) : null}
            <div className={styles.statsGrid}>
              <div className={styles.stat}>
                <strong>{projects.length}</strong>
                <span className={styles.hint}>项目</span>
              </div>
              <div className={styles.stat}>
                <strong>{totalNodeCount}</strong>
                <span className={styles.hint}>剧情节点</span>
              </div>
            </div>
          </aside>
        </section>

        {notice ? (
          <div
            className={`${styles.notice} ${
              notice.tone === "error" ? styles.noticeError : styles.noticeInfo
            }`}
          >
            {notice.message}
          </div>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>项目列表</h2>
            <span className={styles.hint}>{projects.length} 个项目</span>
          </div>

          {isLoading ? (
            <div className={styles.empty}>正在读取项目库...</div>
          ) : projects.length === 0 ? (
            <div className={styles.empty}>
              还没有项目。先新建一个项目，或者导入一个已有项目包。
            </div>
          ) : (
            <div className={styles.projectGrid}>
              {projects.map((project) => (
                <article key={project.id} className={styles.projectCard}>
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
                    <div className={styles.coverPlaceholder}>项目封面</div>
                  )}

                  <div className={styles.projectBody}>
                    <div className={styles.projectTitleRow}>
                      <div className={styles.projectTitleBlock}>
                        <span className={styles.projectPill}>最近更新</span>
                        <h3>{project.name}</h3>
                      </div>
                      <span className={styles.hint}>
                        {formatRelativeTime(project.lastOpenedAt)}
                      </span>
                    </div>

                    <p className={styles.hint}>
                      {project.description || "暂无说明"}
                    </p>

                    <div className={styles.metaGrid}>
                      <span className={styles.metaChip}>{project.stats.characterCount} 角色</span>
                      <span className={styles.metaChip}>{project.stats.sceneCount} 场景</span>
                      <span className={styles.metaChip}>{project.stats.nodeCount} 节点</span>
                      <span className={styles.metaChip}>{project.stats.branchCount} 分支点</span>
                    </div>

                    {renamingProjectId === project.id ? (
                      <div className={styles.renamePanel}>
                        <input
                          className={styles.input}
                          value={renamingName}
                          onChange={(event) => setRenamingName(event.target.value)}
                          placeholder="项目名称"
                        />
                        <textarea
                          className={styles.textarea}
                          value={renamingDescription}
                          onChange={(event) => setRenamingDescription(event.target.value)}
                          placeholder="一句话说明"
                        />
                        <div className={styles.renameActions}>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => void submitProjectRename(project.id)}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
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
                    ) : (
                      <div className={styles.projectActions}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => handleOpenProject(project.id)}
                        >
                          打开项目
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => startRenamingProject(project)}
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          className={styles.dangerButton}
                          onClick={() => void handleDeleteProject(project.id)}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
