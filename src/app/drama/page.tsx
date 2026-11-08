"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type Connection, type ReactFlowInstance } from "@xyflow/react";
import { DRAMA_MODELS, newShot, type DramaMode, type Shot } from "@/lib/drama";
import {
  assetImagePrompt,
  assetThreeViewPrompt,
  newAsset,
  shotContext,
  variantAsset,
  type AssetCard,
} from "@/lib/drama-assets";
import {
  DEFAULT_SCRIPT_MODEL,
  DEFAULT_SCRIPT_PROVIDER,
  DEFAULT_SCRIPT_TONE,
  TONE_OPTIONS,
  normalizeTone,
  SCRIPT_MODELS,
  type ScriptTone,
} from "@/lib/drama-script";
import {
  removeCards,
  duplicateCards,
  copyCards,
  pasteCards,
  type CanvasDocument,
} from "@/lib/drama-edit";
import {
  parseArchive,
  packArchive,
  unpackArchive,
  saveDraft,
  readDraft,
  emptyDramaArchive,
  isDramaSnapshot,
  type DramaArchive,
} from "@/lib/drama-archive";
import {
  loadProject,
  saveProject,
  updateProjectLastOpenedAt,
} from "@/lib/projects";
import { isCannedNegative, userNegativePrompt } from "@/lib/generation-constraints";
import { readReferenceImages } from "@/lib/reference-upload";
import {
  DEFAULT_CHARACTER_IMAGE_MODEL,
  GROK_IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  imageModelShortLabel,
  isLocalFluxModel,
  parseImageModel,
  type ImageGenerationModel,
} from "@/lib/image-generation";
import {
  STUDIO_VIDEO_MODELS,
  LTX_DURATION_MAX,
  LTX_DURATION_MIN,
  studioVideoDefaults,
  clampLtxDuration,
  gpuModelLabel,
  isLtxFamily,
  ltxSupportsRi2v,
  parseShotDuration,
  validateGpuModel,
  type GpuVideoModel,
} from "@/lib/drama-models";
import {
  DIRECTOR_DURATION_MAX,
  DIRECTOR_DURATION_MIN,
  directorOf,
  directorOutputSeconds,
  directorPrompt,
  isDirectorEnabled,
  mergeDirectorReferences,
  parseDirectorDuration,
  seedDirectorPrompt,
  setDirectorDuration,
  slimDirectorForSubmit,
} from "@/lib/drama-timeline";
import {
  applyLastFrameMaterial,
  applyStartFrameMaterial,
  extractLastFrameFromVideo,
  shotStillPrompt,
  usesImageToVideo,
} from "@/lib/drama-frames";
import {
  attachAssets,
  bindProjectAssets,
  ensureMentions,
  planFromShot,
  parseLabeledShotPrompt,
  unbindAsset,
  parsePromptSettings,
  visibleShotPrompt,
  DEFAULT_PROMPT_SETTINGS,
  type DramaPromptSettings,
} from "@/lib/drama-prompt";
import {
  orderedReferenceMedia,
  resolveDirectorState,
} from "@/lib/drama-mentions";
import {
  attachNewShot,
  layoutShotTree,
  linkShot,
  moveShotAmongSiblings,
  shotChildren,
  shotDepth,
  shotParentId,
  shotRoots,
  unlinkShot,
  validateShotLink,
  walkShotTree,
} from "@/lib/drama-tree";
import styles from "./studio.module.css";
import { usePlatformScript } from "./use-platform-script";
import { DramaCanvas, GenerationStatus, type PositionUpdate } from "./canvas";
import { CanvasContextMenu, type CanvasContext, type MenuItem } from "./context-menu";
import { ObjectProperties, ALIGNMENTS } from "./object-properties";
import { alignCards, canvasCoordinate, type Alignment } from "@/lib/drama-canvas-geometry";
import { TimelineDirectorDock } from "./timeline-director";
import { FilmScrubber } from "./film-scrubber";
import { ReferencePrompt } from "./reference-prompt";
import { ReferenceMediaEditor } from "./reference-media";
import { uploadReferenceMedia } from "@/lib/drama-reference-media";
import { hostDirectorImages, hostDramaImage, hostDramaImages } from "@/lib/drama-stills";
import {
  assertDramaSubmitPayload,
  readApiJson,
  translateDramaNetworkError,
} from "@/lib/drama-api";
const STORE = "pencil.drama.v1";
function isGenerating(shot: Pick<Shot, "status">) {
  return ["IN_QUEUE", "IN_PROGRESS", "SUBMITTING"].includes(shot.status || "");
}
function canStopGeneration(shot: Pick<Shot, "status">) {
  return isGenerating(shot) || shot.status === "CHECK_FAILED";
}
const labels: Record<string, string> = {
  IN_QUEUE: "排队中",
  IN_PROGRESS: "生成中",
  COMPLETED: "已完成",
  FAILED: "失败",
  CHECK_FAILED: "查询暂停",
  SUBMITTING: "提交中",
};
async function api(path: string, body: unknown, signal?: AbortSignal) {
  let r: Response;
  try {
    r = await fetch(`/api/drama/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(translateDramaNetworkError(error, "video"));
  }
  const d = await readApiJson(r);
  if (!r.ok) throw new Error(d.error || "请求失败");
  return d;
}
export default function DramaStudio() {
  const router = useRouter();
  const platformScript = usePlatformScript();
  const embedded = platformScript.embedded;
  const [mobilePanel, setMobilePanel] = useState("canvas");
  const scriptModels = embedded ? platformScript.models : SCRIPT_MODELS;
  const [selection, setSelection] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<(CanvasContext & { ids: string[] }) | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [clipboard, setClipboard] = useState<CanvasDocument | null>(null);
  const pasteSequence = useRef(0);
  const [gridVisible, setGridVisible] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const [clearDialog, setClearDialog] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoStack = useRef<CanvasDocument[]>([]),
    redoStack = useRef<CanvasDocument[]>([]);
  const lastEdit = useRef(0);
  const runtime = useRef(new Map<string, Partial<Shot>>());
  const flowRef = useRef<{
    screenToFlowPosition: ReactFlowInstance["screenToFlowPosition"];
    zoomIn: () => void;
    zoomOut: () => void;
    fitView: ReactFlowInstance["fitView"];
    getNodes: ReactFlowInstance["getNodes"];
    getZoom: () => number;
  } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadBusy = useRef(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [imageBusyIds, setImageBusyIds] = useState<string[]>([]);
  const imageBusyRef = useRef(new Set<string>());
  const [imageModel, setImageModel] = useState<ImageGenerationModel>(
    DEFAULT_CHARACTER_IMAGE_MODEL,
  );
  const [imageKey, setImageKey] = useState("");
  const [qwenPrompt, setQwenPrompt] = useState("");
  const [qwenResult, setQwenResult] = useState("");
  const [qwenBusy, setQwenBusy] = useState(false);
  const [scriptKey, setScriptKey] = useState("");
  const [scriptProvider, setScriptProvider] = useState<string>(DEFAULT_SCRIPT_PROVIDER);
  const [scriptModel, setScriptModel] = useState<string>(DEFAULT_SCRIPT_MODEL);
  const [tone, setTone] = useState<ScriptTone>(DEFAULT_SCRIPT_TONE);
  useEffect(() => {
    if (embedded && platformScript.models.length && !platformScript.models.some(m => m.id === scriptModel && !m.availability)) {
      const available = platformScript.models.filter(m => !m.availability);
      setScriptModel(available.find(m => m.id === "deepseek/deepseek-v4.1-flash")?.id ?? available[0]?.id ?? "");
    }
  }, [embedded, platformScript.models, scriptModel]);
  const [assets, setAssets] = useState<AssetCard[]>([]);
  const [shots, setShots] = useState<Shot[]>([]),
    [selected, setSelected] = useState(""),
    [title, setTitle] = useState("未命名短剧"),
    [story, setStory] = useState(""),
    [ratio, setRatio] = useState("9:16"),
    [key, setKey] = useState(""),
    [provider, setProvider] = useState<"comfy" | "fal">("comfy"),
    [gpu, setGpu] = useState<{
      ltx?: {
        ready: boolean;
        loaded: boolean;
        t2v?: boolean;
        pinkcherry?: boolean;
        error?: string;
      };
      connected: boolean;
      ready: boolean;
      director?: boolean;
      models?: Record<string, { available: boolean; name: string }>;
      error?: string;
    }>({ connected: false, ready: false }),
    [settings, setSettings] = useState(false),
    [notice, setNotice] = useState(""),
    [writing, setWriting] = useState(false),
    [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState("本地自动保存"),
    [batch, setBatch] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let active = true;
    const check = () =>
      fetch("/api/drama/health")
        .then((r) => r.json())
        .then((d) => {
          if (active) setGpu(d);
        })
        .catch(() => {
          if (active) setGpu({ connected: false, ready: false });
        });
    check();
    const timer = setInterval(check, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const busy = useRef(new Set<string>());
  const abortors = useRef(new Map<string, AbortController>());
  const cancelFlags = useRef(new Set<string>());
  const batchStop = useRef(false);
  const polling = useRef(false);
  const capturing = useRef(new Set<string>());
  const shotsRef = useRef<Shot[]>([]);
  const assetsRef = useRef<AssetCard[]>([]);
  shotsRef.current = shots;
  assetsRef.current = assets;
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveList, setArchiveList] = useState<
    Array<{ id: string; title: string; savedAt: string }>
  >([]);
  const [vault, setVault] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState("");
  const [promptSettings, setPromptSettings] = useState<DramaPromptSettings>(
    DEFAULT_PROMPT_SETTINGS,
  );
  const [canvasZoom, setCanvasZoom] = useState(0.65);
  const [inspectorScale, setInspectorScale] = useState(1);
  const asset = assets.find((a) => a.id === selected);
  const shot = shots.find((s) => s.id === selected);
  const selectedParentId = shot ? shotParentId(shot) : undefined;
  const shotSiblings = shot
    ? selectedParentId
      ? shotChildren(shots, selectedParentId)
      : shotRoots(shots)
    : [];
  const shotSiblingIndex = shot
    ? shotSiblings.findIndex((item) => item.id === shot.id)
    : -1;
  const running = shots.some((s) =>
    ["IN_QUEUE", "IN_PROGRESS", "SUBMITTING"].includes(s.status || ""),
  );
  useEffect(() => {
    const stored = Number(localStorage.getItem("pencil.drama.inspectorScale"));
    if (stored >= 0.85 && stored <= 1.35) setInspectorScale(stored);
    setImageModel(parseImageModel(localStorage.getItem("pencil.drama.imageModel")));
    setGridVisible(localStorage.getItem("pencil.drama.gridVisible") !== "false");
    setSnapToGrid(localStorage.getItem("pencil.drama.snapToGrid") === "true");
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const savedVault =
          localStorage.getItem("pencil.archive.vault") || crypto.randomUUID();
        localStorage.setItem("pencil.archive.vault", savedVault);
        setVault(savedVault);
        const requestedId = new URLSearchParams(window.location.search).get(
          "project",
        );
        let queryId = requestedId;
        const hydrate = (p: DramaArchive) => {
          setAssets(p.assets);
          setShots(
            p.shots.map((s) =>
              s.status === "SUBMITTING"
                ? {
                    ...s,
                    status: "FAILED",
                    error: "提交被中断，请检查生成服务的任务记录后重试",
                  }
                : s,
            ),
          );
          setProvider(p.provider);
          setTone(normalizeTone(p.tone));
          setTitle(p.title || "未命名悬疑短剧");
          setStory(p.story || "");
          setRatio(p.ratio || "9:16");
          setPromptSettings(parsePromptSettings(p.promptSettings));
          setSelected(p.shots[0]?.id || "");
        };
        if (!queryId) {
          const last = localStorage.getItem("pencil.drama.projectId");
          if (last) {
            queryId = last;
            router.replace(`/video-studio?project=${last}${new URLSearchParams(window.location.search).get("embed") === "framecraft" ? "&embed=framecraft" : ""}`);
          } else {
          const draft = await readDraft("current");
          const raw = draft
            ? JSON.stringify(draft)
            : localStorage.getItem(STORE);
          const archive = raw
            ? parseArchive(JSON.parse(raw))
            : emptyDramaArchive();
          const record = await saveProject({
            name: archive.title || "未命名悬疑短剧",
            description: archive.story.slice(0, 120),
            kind: "drama",
            snapshot: archive,
            referencedAssetIds: [],
            media: [],
          });
          await saveDraft(archive, record.id);
          localStorage.setItem("pencil.drama.projectId", record.id);
          queryId = record.id;
          router.replace(`/video-studio?project=${record.id}${new URLSearchParams(window.location.search).get("embed") === "framecraft" ? "&embed=framecraft" : ""}`);
          }
        }
        let loadedProject;
        try {
          loadedProject = await loadProject(queryId);
        } catch (error) {
          // A stale "last project" pointer must not strand the embedded
          // editor in the standalone project library. Recover its draft first.
          if (requestedId || !(error instanceof Error) || error.message !== "没有找到对应的项目。") throw error;
          const recovered = await readDraft(queryId);
          const archive = recovered ?? emptyDramaArchive();
          const record = await saveProject({ projectId: queryId, name: archive.title || "未命名短剧", description: archive.story.slice(0, 120), kind: "drama", snapshot: archive, referencedAssetIds: [], media: [] });
          loadedProject = { record, media: [] };
          setNotice(recovered ? "已从草稿恢复最近项目。" : "最近项目记录不可用，已为你准备空白画布。");
        }
        if (!isDramaSnapshot(loadedProject.record.snapshot)) {
          router.replace("/projects");
          return;
        }
        const draft = await readDraft(queryId);
        hydrate(draft || parseArchive(loadedProject.record.snapshot));
        setTitle(loadedProject.record.name || loadedProject.record.snapshot.title);
        setProjectId(queryId);
        localStorage.setItem("pencil.drama.projectId", queryId);
        await updateProjectLastOpenedAt(queryId);
      } catch {
        setNotice("项目无法读取，已回到项目库。");
        router.replace("/projects");
        return;
      }
      try {
        const previous = JSON.parse(
          localStorage.getItem("pencil.video-studio.v1") || "null",
        );
        const jobs = Array.isArray(previous) ? previous : previous?.jobs;
        if (
          Array.isArray(jobs) &&
          !localStorage.getItem("pencil.drama.migrated")
        )
          setShots((all) => [
            ...all,
            ...jobs
              .filter(
                (j) =>
                  typeof j.id === "string" &&
                  !all.some((s) => s.id === `legacy-${j.id}`),
              )
              .map((j, i): Shot => ({
                ...newShot(
                  all.length + i,
                  `历史镜头 ${i + 1}`,
                  typeof j.prompt === "string" ? j.prompt : "",
                ),
                id: `legacy-${j.id}`,
                mode: ["t2v", "i2v", "ri2v"].includes(j.mode) ? j.mode : "t2v",
                duration: parseShotDuration(j.duration),
                taskId: j.taskId,
                taskProvider: "comfy" as const,
                status: j.status === "SUBMITTING" ? "FAILED" : j.status,
                videoUrl: j.videoUrl,
                error: j.error,
              })),
          ]);
      } catch {
        /* Keep original storage available for recovery. */
      }
      localStorage.setItem("pencil.drama.migrated", "1");
      setLoaded(true);
    })();
  }, [router]);
  useEffect(() => {
    if (!loaded || !projectId) return;
    const timer = setTimeout(() => {
      void saveDraft({
        version: 2,
        format: "pencil-drama",
        tone,
        title,
        story,
        ratio,
        shots,
        assets,
        provider,
        promptSettings,
      }, projectId)
        .then((doc) =>
          saveProject({
            projectId,
            name: title || "未命名悬疑短剧",
            description: story.slice(0, 120),
            kind: "drama",
            snapshot: doc,
            referencedAssetIds: [],
            media: [],
          }),
        )
        .then(() => setSaving("已保存到项目库"))
        .catch(() => setSaving("保存失败，请下载存档"));
    }, 600);
    return () => clearTimeout(timer);
  }, [
    loaded,
    projectId,
    title,
    story,
    ratio,
    shots,
    assets,
    provider,
    tone,
    promptSettings,
  ]);
  const editLocked =
    !loaded ||
    batch ||
    writing ||
    archiveBusy ||
    uploadingImages ||
    uploadingMedia;
  const selectedIds = selection.length ? selection : selected ? [selected] : [];
  const selectedCards = [...shots, ...assets].filter(card => selectedIds.includes(card.id));
  const multipleSelected = selectedCards.length > 1;
  const selectionGenerating = selectedIds.some((id) => {
    const item = shots.find((s) => s.id === id);
    return Boolean(item && isGenerating(item));
  });
  function checkpoint(coalesce = false) {
    if (editLocked) return;
    if (!coalesce || Date.now() - lastEdit.current > 600) {
      undoStack.current = [
        ...undoStack.current.slice(-49),
        structuredClone({ shots, assets }),
      ];
      redoStack.current = [];
      setHistoryVersion((v) => v + 1);
    }
    lastEdit.current = Date.now();
  }
  function restore(doc: CanvasDocument) {
    setShots(doc.shots.map((s) => ({ ...s, ...runtime.current.get(s.id) })));
    setAssets(doc.assets);
    setSelected("");
    setSelection([]);
    setHistoryVersion((v) => v + 1);
    lastEdit.current = 0;
  }
  function undo() {
    if (editLocked) return;
    if (!canRestore(undoStack.current.at(-1))) return;
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(structuredClone({ shots, assets }));
    restore(previous);
  }
  function redo() {
    if (editLocked) return;
    if (!canRestore(redoStack.current.at(-1))) return;
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(structuredClone({ shots, assets }));
    restore(next);
  }
  function objectsBusy(ids: string[]) {
    return ids.some(id => imageBusyRef.current.has(id) || shots.some(s => s.id === id && isGenerating(s)));
  }
  function canRestore(doc?: CanvasDocument) {
    if (!doc) return false;
    const kept = new Set([...doc.shots, ...doc.assets].map(c => c.id));
    if (objectsBusy([...shots, ...assets].filter(c => !kept.has(c.id)).map(c => c.id))) {
      setNotice("此操作会移除生成中的对象，请先等待完成或停止生成。");
      return false;
    }
    return true;
  }
  function removeByIds(ids: string[]) {
    if (editLocked || !ids.length) return;
    if (objectsBusy(ids)) {
      setNotice("生成中的对象不能删除，请等待完成或停止生成。");
      return;
    }
    checkpoint();
    restore(removeCards({ shots, assets }, ids));
  }
  function removeSelection() { removeByIds(selectedIds); }
  function duplicateByIds(ids: string[]) {
    if (editLocked || !ids.length) return;
    checkpoint();
    const next = duplicateCards({ shots, assets }, ids);
    setShots(next.shots);
    setAssets(next.assets);
    const created = [...next.shots.slice(shots.length), ...next.assets.slice(assets.length)].map(c => c.id);
    setSelection(created);
    setSelected(created[0] ?? "");
  }
  function duplicateSelection() { duplicateByIds(selectedIds); }
  function copySelection(ids = selectedIds) {
    if (!ids.length) return;
    setClipboard(copyCards({ shots, assets }, ids));
    pasteSequence.current = 0;
    setNotice(`已复制 ${ids.length} 个对象，可在当前画布粘贴。`);
  }
  function cutSelection(ids = selectedIds) {
    if (editLocked || objectsBusy(ids)) return;
    copySelection(ids);
    removeByIds(ids);
  }
  function pasteSelection(position?: { x: number; y: number }) {
    if (editLocked || !clipboard) return;
    checkpoint();
    const source = [...clipboard.shots, ...clipboard.assets];
    if (!source.length) return;
    const shift = 45 * ++pasteSequence.current;
    const at = position ?? { x: Math.min(...source.map(c => c.position.x)) + shift, y: Math.min(...source.map(c => c.position.y)) + shift };
    const next = pasteCards({ shots, assets }, clipboard, at);
    setShots(next.shots); setAssets(next.assets);
    const ids = [...next.shots.slice(shots.length), ...next.assets.slice(assets.length)].map(c => c.id);
    setSelected(ids[0] ?? ""); setSelection(ids);
  }
  function arrange() {
    if (editLocked) return;
    checkpoint();
    setAssets((all) =>
      all.map((a, i) => a.positionLocked ? a : ({ ...a, position: { x: -360, y: i * 300 } })),
    );
    setShots((all) => layoutShotTree(all).map(s => all.find(old => old.id === s.id && old.positionLocked) ?? s));
  }
  function commitPositions(updates: PositionUpdate[]) {
    if (editLocked || !updates.length) return;
    const byId = new Map(updates.flatMap(item => {
      const x = canvasCoordinate(item.position.x), y = canvasCoordinate(item.position.y);
      return x === null || y === null ? [] : [[item.id, { x, y }] as const];
    }));
    setShots((all) => {
      let changed = false;
      const next = all.map((shot) => {
        const position = byId.get(shot.id);
        if (
          !position || shot.positionLocked ||
          (shot.position.x === position.x && shot.position.y === position.y)
        )
          return shot;
        changed = true;
        return { ...shot, position };
      });
      return changed ? next : all;
    });
    setAssets((all) => {
      let changed = false;
      const next = all.map((asset) => {
        const position = byId.get(asset.id);
        if (
          !position || asset.positionLocked ||
          (asset.position.x === position.x && asset.position.y === position.y)
        )
          return asset;
        changed = true;
        return { ...asset, position };
      });
      return changed ? next : all;
    });
  }
  function lockObjects(ids: string[], locked: boolean) {
    if (editLocked) return;
    checkpoint();
    setShots(all => all.map(c => ids.includes(c.id) ? { ...c, positionLocked: locked } : c));
    setAssets(all => all.map(c => ids.includes(c.id) ? { ...c, positionLocked: locked } : c));
  }
  function alignObjects(ids: string[], alignment: Alignment) {
    if (editLocked) return;
    const dimensions = new Map(flowRef.current?.getNodes().map(n => [n.id, { width: n.measured?.width ?? n.width ?? 300, height: n.measured?.height ?? n.height ?? 300 }]) ?? []);
    const updates = alignCards([...shots, ...assets].filter(c => ids.includes(c.id)), alignment, dimensions);
    if (!updates.length) return;
    checkpoint(); commitPositions(updates);
  }
  function inspectObject(id: string) {
    setSelected(id); setSelection([]); setMobilePanel("inspector");
    requestAnimationFrame(() => inspectorRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus());
  }
  function openContextMenu(context: CanvasContext) {
    const ids = context.kind === "node" && context.id ? (selectedIds.includes(context.id) ? selectedIds : [context.id]) : [];
    if (context.kind === "node") { setSelected(context.id ?? ""); setSelection(ids); }
    setContextMenu({ ...context, ids });
  }
  function unlink(childId: string) {
    if (editLocked || objectsBusy([childId])) return;
    checkpoint(); setShots(all => unlinkShot(all, childId));
  }
  function contextItems(context: CanvasContext & { ids: string[] }): MenuItem[] {
    if (context.kind === "edge") return [
      { id: "source", label: "编辑前一镜头", action: () => inspectObject(context.source!) },
      { id: "target", label: "编辑后一镜头", action: () => inspectObject(context.target!) },
      { id: "unlink", label: "断开连线", danger: true, separator: true, disabled: editLocked || objectsBusy([context.target!]), action: () => unlink(context.target!) },
    ];
    if (context.kind === "node") {
      const ids = context.ids;
      const cards = [...shots, ...assets].filter(c => ids.includes(c.id));
      const locked = cards.length > 0 && cards.every(c => c.positionLocked);
      const busy = objectsBusy(ids);
      const currentShot = ids.length === 1 ? shots.find(s => s.id === ids[0]) : undefined;
      return [
        { id: "properties", label: "编辑属性", action: () => { if (ids.length === 1) inspectObject(ids[0]); else setMobilePanel("inspector"); } },
        { id: "copy", label: "复制", shortcut: "⌘/Ctrl C", action: () => copySelection(ids), separator: true },
        { id: "cut", label: "剪切", shortcut: "⌘/Ctrl X", disabled: editLocked || busy, action: () => cutSelection(ids) },
        { id: "duplicate", label: "制作副本", shortcut: "⌘/Ctrl D", disabled: editLocked, action: () => duplicateByIds(ids) },
        { id: "paste", label: "粘贴到这里", shortcut: "⌘/Ctrl V", disabled: editLocked || !clipboard, action: () => pasteSelection(context.flow) },
        ...(currentShot ? [
          { id: "follow", label: "添加后续镜头", disabled: editLocked, action: () => add(false, { x: currentShot.position.x + 360, y: currentShot.position.y }, currentShot.id) },
          { id: "unlink", label: "断开前一镜头", disabled: editLocked || busy || !shotParentId(currentShot), action: () => unlink(currentShot.id) },
        ] : []),
        { id: "lock", label: "锁定位置", checked: locked, separator: true, disabled: editLocked, action: () => lockObjects(ids, !locked) },
        { id: "fit", label: "聚焦所选对象", action: () => { void flowRef.current?.fitView({ nodes: ids.map(id => ({ id })), padding: 0.25, duration: 250 }); } },
        ...(ids.length > 1 ? ALIGNMENTS.map((alignment, i) => ({ id: alignment.id, label: alignment.label, separator: i === 0, disabled: editLocked || cards.some(c => c.positionLocked) || ((alignment.id === "horizontal" || alignment.id === "vertical") && ids.length < 3), action: () => alignObjects(ids, alignment.id) })) : []),
        { id: "delete", label: ids.length > 1 ? `删除 ${ids.length} 个对象` : "删除对象", shortcut: "Delete", separator: true, danger: true, disabled: editLocked || busy, action: () => removeByIds(ids) },
      ];
    }
    return [
      { id: "shot", label: "新建镜头", disabled: editLocked, action: () => add(false, context.flow, null) },
      { id: "reference", label: "新建角色参考卡", disabled: editLocked, action: () => addAsset("reference", context.flow) },
      { id: "scene", label: "新建场景卡", disabled: editLocked, action: () => addAsset("scene", context.flow) },
      { id: "paste", label: "粘贴到这里", shortcut: "⌘/Ctrl V", separator: true, disabled: editLocked || !clipboard, action: () => pasteSelection(context.flow) },
      { id: "undo", label: "撤销", shortcut: "⌘/Ctrl Z", disabled: editLocked || !undoStack.current.length, action: undo },
      { id: "redo", label: "重做", shortcut: "⌘/Ctrl ⇧ Z", disabled: editLocked || !redoStack.current.length, action: redo },
      { id: "all", label: "全选对象", shortcut: "⌘/Ctrl A", disabled: !shots.length && !assets.length, separator: true, action: () => setSelection([...shots, ...assets].map(c => c.id)) },
      { id: "arrange", label: "整理布局", disabled: editLocked || (!shots.length && !assets.length), action: arrange },
      { id: "fit", label: "适应全部对象", action: () => { void flowRef.current?.fitView({ padding: 0.18, duration: 250 }); } },
      { id: "grid", label: "显示网格", checked: gridVisible, separator: true, action: () => { setGridVisible(!gridVisible); localStorage.setItem("pencil.drama.gridVisible", String(!gridVisible)); } },
      { id: "snap", label: "吸附网格", checked: snapToGrid, action: () => { setSnapToGrid(!snapToGrid); localStorage.setItem("pencil.drama.snapToGrid", String(!snapToGrid)); } },
      { id: "clear", label: "清空画布…", separator: true, danger: true, disabled: editLocked || running || imageBusyIds.length > 0 || (!shots.length && !assets.length), action: () => setClearDialog(true) },
    ];
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        settings ||
        clearDialog ||
        contextMenu ||
        (e.target instanceof HTMLElement &&
          e.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === "c" && selectedIds.length) {
        e.preventDefault(); copySelection();
      } else if (mod && e.key.toLowerCase() === "x" && selectedIds.length) {
        e.preventDefault(); cutSelection();
      } else if (mod && e.key.toLowerCase() === "v" && clipboard) {
        e.preventDefault(); pasteSelection();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection([...shots, ...assets].map((s) => s.id));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection();
      } else if (e.key === "Escape") {
        setSelection([]);
        setSelected("");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  function patch(id: string, p: Partial<Shot>) {
    if ("status" in p || "taskId" in p)
      runtime.current.set(id, { ...runtime.current.get(id), ...p });
    else checkpoint(true);
    setShots((all) => all.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }
  function setShotDuration(current: Shot, duration: number) {
    if (isGenerating(current)) return;
    const director = directorOf(current.timelineDirector, current.duration);
    const seconds = director.enabled
      ? parseDirectorDuration(duration)
      : parseShotDuration(duration);
    const next = {
      ...current,
      duration: seconds,
      ...(director.enabled
        ? { timelineDirector: setDirectorDuration(director, seconds) }
        : {}),
    };
    patch(current.id, {
      duration: seconds,
      ...(director.enabled
        ? { timelineDirector: next.timelineDirector }
        : {}),
      ...(current.modelPick !== "manual"
        ? planFromShot(next, assets, tone, gpu)
        : {}),
    });
  }
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        for (const s of shots.filter(
          (s) =>
            s.taskId &&
            (s.taskProvider === "comfy" || key) &&
            ["IN_QUEUE", "IN_PROGRESS"].includes(s.status || "") &&
            !cancelFlags.current.has(s.id),
        )) {
          try {
            const d = await api("video", {
              action: "status",
              provider: s.taskProvider || "fal",
              apiKey: key,
              mode: s.taskMode || s.mode,
              taskId: s.taskId,
              videoModel: s.taskVideoModel ?? "h3",
            });
            if (!cancelled && !cancelFlags.current.has(s.id)) {
              patch(s.id, {
                status: d.status,
                queuePosition: d.queuePosition,
                statusUpdatedAt: Date.now(),
                generationFinishedAt: ["COMPLETED", "FAILED"].includes(d.status) ? Date.now() : undefined,
                videoUrl: d.videoUrl,
                error: d.error,
              });
              if (d.status === "COMPLETED" && d.videoUrl)
                void captureEndFrame(s.id, d.videoUrl);
            }
          } catch (e) {
            if (!cancelled && !cancelFlags.current.has(s.id)) {
              patch(s.id, {
                status: "CHECK_FAILED",
                statusUpdatedAt: Date.now(),
                error: translateDramaNetworkError(e, "status"),
              });
            }
          }
        }
      } finally {
        polling.current = false;
      }
    };
    const timer = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, running, shots]);
  function addAsset(kind: AssetCard["kind"], position?: { x: number; y: number }) {
    if (editLocked) return;
    checkpoint();
    const a = { ...newAsset(kind, assets.length), ...(position ? { position } : {}) };
    const nextAssets = [...assets, a];
    setAssets(nextAssets);
    setShots((all) =>
      all.map((s) => attachAssets(s, nextAssets, [a.id])),
    );
    setSelected(a.id);
    setSelection([]);
  }
  async function importImages(
    files: File[],
    position: { x: number; y: number },
    targetId?: string,
  ) {
    if (editLocked || uploadBusy.current) {
      setNotice("请等待当前操作完成后导入图片。");
      return;
    }
    if (targetId && files.length !== 1) {
      setNotice("替换卡片时请只拖入一张图片；多张图片可拖到空白画布。");
      return;
    }
    uploadBusy.current = true;
    checkpoint();
    setUploadingImages(true);
    try {
      const images = await readReferenceImages(files);
      if (targetId) {
        setAssets((all) =>
          all.map((a) =>
            a.id === targetId ? { ...a, imageUrl: images[0].imageUrl } : a,
          ),
        );
        setSelected(targetId);
      } else {
        const cards = images.map((image, i) => ({
          ...newAsset("reference", assets.length + i),
          ...image,
          position: {
            x: position.x + (i % 3) * 350,
            y: position.y + Math.floor(i / 3) * 360,
          },
        }));
        const nextAssets = [...assets, ...cards];
        setAssets(nextAssets);
        setShots((all) =>
          all.map((s) =>
            attachAssets(
              s,
              nextAssets,
              cards.map((card) => card.id),
            ),
          ),
        );
        setSelected(cards[0].id);
      }
      setNotice(`已导入 ${images.length} 张参考图，将随创作存档保存。`);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "图片无法读取，请换一张图片。",
      );
    } finally {
      uploadBusy.current = false;
      setUploadingImages(false);
    }
  }
  async function requestStill(
    prompt: string,
    negativePrompt?: string,
    image?: string,
    size?: "1K" | "2K",
  ) {
    const response = await fetch("/api/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: imageModel,
        negativePrompt: userNegativePrompt(negativePrompt),
        apiKey: isLocalFluxModel(imageModel)
          ? undefined
          : imageKey.trim() ||
            (imageModel === GROK_IMAGE_MODEL ? scriptKey.trim() : ""),
        prompt,
        image,
        size: size === "2K" ? "2K" : "1K",
      }),
      signal: AbortSignal.timeout(180000),
    });
    const result = await response.json();
    if (!response.ok || !result.b64Json)
      throw new Error(result.message || "生图未返回图片");
    return `data:${result.mimeType || "image/png"};base64,${result.b64Json}`;
  }
  async function requestQwenPrompt() {
    if (!qwenPrompt.trim()) {
      setNotice("请先输入 Qwen Image 的画面想法。");
      return;
    }
    setQwenBusy(true);
    try {
      const response = await fetch("/api/qwen-image/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: qwenPrompt.trim() }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await response.json();
      if (!response.ok || typeof data.text !== "string")
        throw new Error(data.error || "Qwen 提示词服务失败。");
      setQwenResult(data.text);
      setNotice("Qwen Image 2.1 Heretic 已返回提示词。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Qwen 提示词服务失败。");
    } finally {
      setQwenBusy(false);
    }
  }
  function applyFrameState(result: { shots: Shot[]; assets: AssetCard[] }) {
    shotsRef.current = result.shots;
    assetsRef.current = result.assets;
    setShots(result.shots);
    setAssets(result.assets);
  }
  async function captureEndFrame(shotId: string, videoUrl: string) {
    const current = shotsRef.current.find((s) => s.id === shotId);
    if (
      !current ||
      capturing.current.has(shotId) ||
      (current.endStill && current.videoUrl === videoUrl)
    )
      return;
    capturing.current.add(shotId);
    try {
      let imageUrl = "";
      try {
        imageUrl = await extractLastFrameFromVideo(videoUrl);
      } catch {
        const response = await fetch("/api/drama/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl }),
        });
        const data = await response.json();
        if (!response.ok || !data.b64Json)
          throw new Error(data.error || "抽帧失败");
        imageUrl = `data:${data.mimeType || "image/jpeg"};base64,${data.b64Json}`;
      }
      const shots = shotsRef.current.map((s) =>
        s.id === shotId ? { ...s, videoUrl, status: "COMPLETED" } : s,
      );
      const shot = shots.find((s) => s.id === shotId);
      if (!shot) return;
      applyFrameState(
        applyLastFrameMaterial({
          shot,
          shots,
          assets: assetsRef.current,
          imageUrl,
        }),
      );
      setNotice(
        `已留下「${shot.title}」尾帧素材${
          shotsRef.current.some(
            (s) =>
              shotParentId(s) === shotId &&
              usesImageToVideo(s) &&
              s.firstFrame === imageUrl,
          )
            ? "，并接到后续镜头首帧"
            : ""
        }。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "成片已完成，但尾帧未能保存为素材。",
      );
    } finally {
      capturing.current.delete(shotId);
    }
  }
  async function generateShotStill(shot: Shot, fromGenerate = false) {
    if (uploadBusy.current || imageBusyRef.current.has(shot.id)) return "";
    if (!fromGenerate && (batch || writing || archiveBusy))
      return "";
    if (!visibleShotPrompt(shot).trim()) {
      setSelected(shot.id);
      setNotice("请先写镜头画面，再生成 I2V 首帧。");
      return "";
    }
    checkpoint();
    imageBusyRef.current.add(shot.id);
    setImageBusyIds([...imageBusyRef.current]);
    try {
      const imageUrl = await requestStill(
        shotStillPrompt(shot, assetsRef.current),
        shot.negativePrompt,
      );
      applyFrameState(
        applyStartFrameMaterial({
          shot: shotsRef.current.find((s) => s.id === shot.id) || shot,
          shots: shotsRef.current,
          assets: assetsRef.current,
          imageUrl,
        }),
      );
      setNotice(`「${shot.title}」首帧已生成，可用于 I2V。`);
      return imageUrl;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "首帧生图失败，请重试。",
      );
      return "";
    } finally {
      imageBusyRef.current.delete(shot.id);
      setImageBusyIds([...imageBusyRef.current]);
    }
  }
  function applyAssetImage(id: string, imageUrl: string) {
    const nextAssets = assetsRef.current.map((a) =>
      a.id === id ? { ...a, imageUrl } : a,
    );
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    setShots((all) =>
      all.map((s) =>
        (s.assetIds || []).includes(id) ? attachAssets(s, nextAssets) : s,
      ),
    );
  }
  async function generateAssetImage(card: AssetCard) {
    if (uploadBusy.current || batch || writing || archiveBusy) return;
    const source =
      assetsRef.current.find((item) => item.id === card.id) || card;
    if (!source.description.trim()) {
      setSelected(source.id);
      setNotice("请先填写卡片的外观或场景描述，再生成参考图。");
      return;
    }
    let target = source;
    if (imageBusyRef.current.has(source.id)) {
      const offset =
        assetsRef.current.filter(
          (item) => item.kind === source.kind && item.title === source.title,
        ).length;
      target = variantAsset(source, offset);
      checkpoint(true);
      const nextAssets = [...assetsRef.current, target];
      assetsRef.current = nextAssets;
      setAssets(nextAssets);
      setSelected(target.id);
    } else {
      checkpoint();
    }
    imageBusyRef.current.add(target.id);
    setImageBusyIds([...imageBusyRef.current]);
    try {
      const latest =
        assetsRef.current.find((item) => item.id === target.id) || target;
      const imageUrl = await requestStill(
        assetImagePrompt(latest),
        userNegativePrompt(latest.negativePrompt),
        undefined,
        "1K",
      );
      applyAssetImage(target.id, imageUrl);
      const pending = imageBusyRef.current.size - 1;
      setNotice(
        pending > 0
          ? `「${latest.title}」参考图已保存；还有 ${pending} 张正在并发生成。`
          : `「${latest.title}」参考图已保存；已绑定镜头会自动补上 @ 引用。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "生图失败，原参考图已保留。",
      );
    } finally {
      imageBusyRef.current.delete(target.id);
      setImageBusyIds([...imageBusyRef.current]);
    }
  }
  async function generateAssetThreeView(card: AssetCard) {
    if (uploadBusy.current || batch || writing || archiveBusy) return;
    const source =
      assetsRef.current.find((item) => item.id === card.id) || card;
    if (source.kind !== "reference") {
      setNotice("三视图只用于角色参考卡。");
      return;
    }
    if (!source.imageUrl.trim()) {
      setSelected(source.id);
      setNotice("请先生成或导入角色图，再出三视图。");
      return;
    }
    checkpoint(true);
    const offset =
      assetsRef.current.filter(
        (item) => item.kind === "reference" && item.title.includes("三视图"),
      ).length + 1;
    const target = {
      ...variantAsset(source, offset),
      title: `${source.title.replace(/\s*·\s*三视图$/, "")} · 三视图`,
    };
    const nextAssets = [...assetsRef.current, target];
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    setShots((all) =>
      all.map((s) =>
        (s.assetIds || []).includes(source.id)
          ? attachAssets(
              { ...s, assetIds: [...(s.assetIds || []), target.id] },
              nextAssets,
            )
          : s,
      ),
    );
    setSelected(target.id);
    imageBusyRef.current.add(target.id);
    setImageBusyIds([...imageBusyRef.current]);
    try {
      const imageUrl = await requestStill(
        assetThreeViewPrompt(source),
        userNegativePrompt(source.negativePrompt),
        source.imageUrl,
        "2K",
      );
      applyAssetImage(target.id, imageUrl);
      setNotice(`「${target.title}」已按参考图生成三视图，并绑到同一批镜头。`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "三视图生成失败，原角色图已保留。",
      );
    } finally {
      imageBusyRef.current.delete(target.id);
      setImageBusyIds([...imageBusyRef.current]);
    }
  }
  function patchAsset(id: string, change: Partial<AssetCard>) {
    checkpoint(true);
    setAssets((all) => all.map((a) => (a.id === id ? { ...a, ...change } : a)));
  }
  function stampShot(shot: Shot, allAssets: AssetCard[]) {
    const bound = bindProjectAssets(
      { ...shot, ...studioVideoDefaults() },
      allAssets,
    );
    return { ...bound, ...planFromShot(bound, allAssets, tone, gpu) };
  }
  function add(asBranch = false, position?: { x: number; y: number }, parentOverride?: string | null) {
    if (editLocked) return;
    const parent = shots.find((item) => item.id === (parentOverride === undefined ? selected : parentOverride));
    if (asBranch && !parent) {
      setNotice("先选一个镜头，再从它分出支线。");
      return;
    }
    checkpoint();
    const attached = attachNewShot(shots, newShot(shots.length), parent?.id);
    const s = stampShot({ ...attached, ...(position ? { position } : {}) }, assets);
    setShots((all) => [...all, s]);
    setSelected(s.id);
    setSelection([]);
  }
  function connectShots(connection: Connection) {
    if (editLocked || (connection.target && objectsBusy([connection.target]))) return;
    const source = connection.source;
    const target = connection.target;
    if (!source || !target) return;
    const error = validateShotLink(shots, source, target);
    if (error) {
      setNotice(error);
      return;
    }
    checkpoint();
    setShots((all) => {
      const next = linkShot(all, source, target);
      return Array.isArray(next) ? next : all;
    });
  }
  async function generate(s: Shot) {
    if (busy.current.has(s.id) || uploadingMedia) return;
    if (provider === "comfy" && s.modelPick === "manual" &&
        !STUDIO_VIDEO_MODELS.some(model => model.id === s.videoModel)) {
      setNotice("该旧模型入口已暂停，请在视频模型中选择 H3 或自动选择。");
      setSelected(s.id);
      return;
    }
    if (provider === "fal" && !key) {
      setSettings(true);
      setNotice("填写 fal.ai API Key 后即可生成。");
      return;
    }
    if (isDirectorEnabled(s.timelineDirector) && provider !== "comfy") {
      setNotice("时间线导演台只支持自有 GPU 的 H3。");
      return;
    }
    if (
      provider === "comfy" &&
      s.modelPick === "manual" &&
      s.videoModel === "ltx-sulphur" &&
      !gpu.ltx?.t2v
    ) {
      setNotice(
        "Sulphur 2 T2V 未就绪：把 pencil_sulphur_t2v.py 装到 10Eros 后端并重启 6008。",
      );
      return;
    }
    cancelFlags.current.delete(s.id);
    const abort = new AbortController();
    abortors.current.set(s.id, abort);
    busy.current.add(s.id);
    patch(s.id, {
      status: "SUBMITTING",
      error: undefined,
      generationStartedAt: Date.now(),
      generationFinishedAt: undefined,
      statusUpdatedAt: Date.now(),
      queuePosition: undefined,
    });
    try {
      let firstFrame = s.firstFrame;
      if (usesImageToVideo(s) && !firstFrame && !isDirectorEnabled(s.timelineDirector)) {
        firstFrame = await generateShotStill(s, true);
        if (cancelFlags.current.has(s.id) || abort.signal.aborted) return;
        if (!firstFrame) throw new Error("I2V 需要先生成首帧图。");
      }
      const latest = shotsRef.current.find((item) => item.id === s.id) || {
        ...s,
        firstFrame,
      };
      const plan = planFromShot(
        { ...latest, firstFrame },
        assetsRef.current,
        tone,
        gpu,
      );
      const planned = { ...latest, firstFrame, ...plan };
      patch(s.id, plan);
      const context = shotContext(planned, assetsRef.current, tone, promptSettings);
      const restored = [];
      for (const m of latest.referenceMedia || []) {
        if (cancelFlags.current.has(s.id) || abort.signal.aborted) return;
        if (m.url.startsWith("blob:") || m.url.startsWith("data:")) {
          let blob: Blob;
          try {
            blob = await (await fetch(m.url)).blob();
          } catch {
            throw new Error("参考素材已失效，请重新导入音视频后再生成。");
          }
          restored.push({...await uploadReferenceMedia(blob, m.name, m.kind, n => setNotice(`恢复参考素材 ${m.name} · ${n}%`)), slotId: m.slotId || m.id});
        } else restored.push(m);
      }
      const referenceMedia = orderedReferenceMedia({
        ...latest,
        referenceMedia: restored,
      });
      if (referenceMedia.length) patch(s.id, { referenceMedia, status: "SUBMITTING" });
      const director = directorOf(latest.timelineDirector, latest.duration);
      let timelineDirector = director.enabled ? director : undefined;
      if (timelineDirector) {
        const merged = mergeDirectorReferences(
          timelineDirector,
          { ...latest, referenceMedia },
          assetsRef.current,
        );
        if (merged.images.length)
          setNotice("导演台参考图上传到 GPU…");
        const hosted = await hostDirectorImages(merged, abort.signal);
        const seeded = seedDirectorPrompt(hosted, context.prompt);
        const mentioned = resolveDirectorState(
          seeded,
          { ...latest, referenceMedia },
          assetsRef.current,
        );
        timelineDirector = slimDirectorForSubmit(mentioned);
        patch(s.id, { timelineDirector: seeded, status: "SUBMITTING" });
        setNotice("");
      }
      const payload = {
        action: "create",
        videoModel: timelineDirector ? "h3" : plan.videoModel,
        provider,
        apiKey: key,
        mode: timelineDirector ? "t2v" : context.mode,
        prompt: timelineDirector
          ? directorPrompt(timelineDirector, context.prompt)
          : context.prompt,
        duration: timelineDirector
          ? directorOutputSeconds(timelineDirector)
          : plan.duration,
        firstFrame:
          !timelineDirector && context.mode === "i2v"
            ? await hostDramaImage(firstFrame, abort.signal)
            : "",
        lastFrame:
          !timelineDirector && context.mode === "i2v"
            ? await hostDramaImage(s.lastFrame, abort.signal)
            : "",
        references: timelineDirector
          ? []
          : await hostDramaImages(
              context.references,
              (done, total) =>
                setNotice(
                  total > 1
                    ? `正在上传参考图 ${done}/${total}…`
                    : "正在上传参考图…",
                ),
              abort.signal,
            ),
        referenceMedia: timelineDirector ? [] : referenceMedia,
        timelineDirector,
        aspectRatio: ratio,
      };
      assertDramaSubmitPayload(payload);
      setNotice("正在提交生成…");
      const d = await api("video", payload, abort.signal);
      if (cancelFlags.current.has(s.id) || abort.signal.aborted) {
        await api("video", {
          action: "cancel",
          provider,
          apiKey: key,
          mode: context.mode,
          taskId: d.taskId,
          videoModel: d.videoModel ?? plan.videoModel,
        }).catch(() => {});
        return;
      }
      patch(s.id, {
        taskId: d.taskId,
        taskMode: context.mode,
        taskProvider: provider,
        taskVideoModel: d.videoModel ?? "h3",
        status: d.status,
        statusUpdatedAt: Date.now(),
        videoUrl: undefined,
        endStill: undefined,
      });
      setNotice("");
    } catch (e) {
      if (
        cancelFlags.current.has(s.id) ||
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        patch(s.id, {
          status: "FAILED",
          generationFinishedAt: Date.now(),
          statusUpdatedAt: Date.now(),
          error: "已终止生成",
        });
        return;
      }
      patch(s.id, {
        status: "FAILED",
        generationFinishedAt: Date.now(),
        statusUpdatedAt: Date.now(),
        error: translateDramaNetworkError(e, "video"),
      });
    } finally {
      abortors.current.delete(s.id);
      busy.current.delete(s.id);
    }
  }
  async function stopGenerate(s: Shot) {
    cancelFlags.current.add(s.id);
    abortors.current.get(s.id)?.abort();
    busy.current.delete(s.id);
    patch(s.id, {
      status: "FAILED",
      generationFinishedAt: Date.now(),
      statusUpdatedAt: Date.now(),
      error: "已终止生成",
      queuePosition: undefined,
    });
    setNotice("正在终止生成并释放显存…");
    try {
      await api("video", {
        action: "cancel",
        provider: s.taskProvider || provider,
        apiKey: key,
        mode: s.taskMode || s.mode,
        taskId: s.taskId,
        videoModel: s.taskVideoModel ?? s.videoModel ?? "h3",
      });
      setNotice("已终止生成。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "终止请求已发出，请稍后刷新状态。");
    }
  }
  async function stopAllGenerating() {
    batchStop.current = true;
    const active = shotsRef.current.filter((item) => canStopGeneration(item));
    if (!active.length) {
      setNotice("当前没有进行中的生成。");
      return;
    }
    await Promise.all(active.map((item) => stopGenerate(item)));
  }
  async function write() {
    checkpoint();
    setWriting(true);
    setNotice("");
    try {
      const d = embedded ? await platformScript.generate({ story, model: scriptModel, tone, assets: assets.map(({ kind, title, description }) => ({ kind, title, description })) }) : await api("script", {
        story,
        scriptKey,
        scriptProvider,
        scriptModel,
        tone,
        assets: assets.map(({ kind, title, description }) => ({
          kind,
          title,
          description,
        })),
      });
      const created: AssetCard[] = (d.assets || []).map(
        (
          a: { kind: AssetCard["kind"]; title: string; description: string },
          i: number,
        ) => ({
          ...newAsset(a.kind, assets.length + i),
          title: a.title,
          description: a.description,
        }),
      );
      const allAssets = [...assets, ...created];
      setAssets(allAssets);
      const next: Shot[] = d.shots.map(
        (
          s: {
            title: string;
            prompt: string;
            promptFields?: Shot["promptFields"];
            duration?: number;
          },
          i: number,
        ) =>
          stampShot(
            {
              ...newShot(shots.length + i, s.title, s.prompt),
              promptFields: s.promptFields,
              duration: parseShotDuration(s.duration),
            },
            allAssets,
          ),
      );
      const parent = shots.find((item) => item.id === selected);
      const chained = next.map((s: Shot, i: number) => ({
        ...s,
        parentId: i === 0 ? parent?.id : next[i - 1].id,
        position: {
          x: (parent?.position.x || 0) + (i + (parent ? 1 : 0)) * 360,
          y:
            (parent?.position.y || 0) +
            (i === 0 && parent ? shotChildren(shots, parent.id).length * 180 : 0),
        },
      }));
      setTitle(d.title);
      setShots((all) => [...all, ...chained]);
      setSelected(chained[0].id);
      setNotice(
        `已添加 ${next.length} 个分镜、${created.length} 张设定卡。模型会按时长和素材自动选择；已绑定参考并插入 @ 引用。`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "剧本生成失败");
    } finally {
      setWriting(false);
    }
  }
  function archiveDocument() {
    return parseArchive({
      version: 1,
      title,
      story,
      ratio,
      shots,
      assets,
      tone,
      provider,
    });
  }
  function openArchive(doc: DramaArchive) {
    setShots(doc.shots);
    setAssets(doc.assets);
    setTitle(doc.title);
    setStory(doc.story);
    setRatio(doc.ratio);
    setProvider(doc.provider);
    setTone(doc.tone);
    setSelected("");
    setSelection([]);
    undoStack.current = [];
    redoStack.current = [];
    runtime.current.clear();
    setHistoryVersion((v) => v + 1);
  }
  async function download() {
    setArchiveBusy(true);
    try {
      const blob = await packArchive(archiveDocument());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.pencil.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("存档已下载，包含参考素材与已生成视频。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "存档下载失败");
    } finally {
      setArchiveBusy(false);
    }
  }
  async function cloudArchives(action: "list" | "save" | "load", id?: string) {
    setArchiveBusy(true);
    try {
      const headers = {
        "Content-Type": "application/json",
        "X-Archive-Vault": vault,
      };
      if (action === "save") {
        const blob = await packArchive(archiveDocument());
        const upload = crypto.randomUUID();
        const size = 512 * 1024,
          total = Math.ceil(blob.size / size);
        for (let index = 0; index < total; index++) {
          const bytes = new Uint8Array(
            await blob.slice(index * size, (index + 1) * size).arrayBuffer(),
          );
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          const r = await fetch("/api/drama/archives", {
            method: "POST",
            headers,
            body: JSON.stringify({
              action: "chunk",
              id: upload,
              index,
              total,
              data: btoa(binary),
              title,
            }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "云端保存失败");
        }
        setNotice("已保存到远程存档库。");
      }
      if (action === "load") {
        const chunks: Blob[] = [];
        let total = 1,
          received = 0,
          part = 0;
        while (received < total) {
          const r = await fetch(
            `/api/drama/archives?id=${encodeURIComponent(id!)}&part=${part++}`,
            { headers },
          );
          if (!r.ok) throw new Error((await r.json()).error || "读取失败");
          total = Number(r.headers.get("X-Archive-Size"));
          if (!total || total > 512 * 1024 * 1024)
            throw new Error("云端存档大小无效");
          const chunk = await r.blob();
          if (!chunk.size) throw new Error("云端存档不完整");
          chunks.push(chunk);
          received += chunk.size;
        }
        const { doc } = await unpackArchive(new Blob(chunks));
        openArchive(doc);
        setNotice("已恢复远程存档。");
      } else {
        const r = await fetch("/api/drama/archives", { headers });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "读取存档列表失败");
        setArchiveList(d.archives);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "存档操作失败");
    } finally {
      setArchiveBusy(false);
    }
  }
  function example() {
    checkpoint();
    const names = ["门关上之后", "走廊尽头", "贴着墙的录音"];
    const beats = [
      {
        start: "26岁林晚与29岁周衡站在酒店套房门口，门缝里传出一段陌生录音，走廊尽头的脚步声忽远忽近。",
        action: "周衡关上门，把录音暂停在关键一句；林晚发现门把手上沾着与案发现场相同的灰尘。",
        camera: "15秒连续中近景，镜头缓慢推近，不切镜。",
        setting: "暖色落地灯、深色木门、半掩的窗帘，房间里保留着刚有人离开的痕迹。",
        sound: "录音机底噪、门外脚步和压低的争执声。",
        end: "录音里出现林晚自己的声音，但她确定自己从未说过这句话。",
      },
      {
        start: "林晚把录音倒回，发现背景里有一阵三短一长的敲门声；周衡的手机同时收到匿名照片。",
        action: "两人沿走廊寻找声音来源，周衡挡住监控盲区，林晚从墙缝取出一枚带血的储物柜钥匙。",
        camera: "15秒连续侧面中景，机位跟随两人移动。",
        setting: "酒店走廊冷白灯与套房暖光交界，监控指示灯断续闪烁。",
        sound: "远处电梯提示音、鞋跟回声和手机震动。",
        end: "匿名照片拍摄于十分钟前，画面里正是他们现在站着的位置。",
      },
      {
        start: "林晚和周衡回到套房，墙上的装饰画后露出一只旧录音笔，红灯正在闪烁。",
        action: "周衡拆开录音笔，林晚对照钥匙上的编号；门外有人用他们刚才听到的节奏敲门。",
        camera: "15秒连续中近景，镜头缓慢靠近录音笔与两人的表情。",
        setting: "同一酒店套房，暖光不换景，窗外霓虹映在墙面。",
        sound: "录音笔电流声、三短一长的敲门声和屏住的呼吸。",
        end: "录音笔自动播放：‘如果你们听到这里，说明我已经死了。’",
      },
    ];
    const actress = {
      ...newAsset("reference", assets.length),
      title: "林晚 · 26岁",
      description:
        "26岁成年女性，黑色长发，米色风衣与深色长裤，神情克制但警觉。所有镜头保持同一张脸、发型和服装。",
    };
    const actor = {
      ...newAsset("reference", assets.length + 1),
      title: "周衡 · 29岁",
        description:
        "29岁成年男性，短发，深色衬衫和长裤，随身携带旧录音笔。所有镜头保持同一张脸、发型和服装。",
    };
    const scene = {
      ...newAsset("scene", assets.length + 2),
      title: "酒店套房 · 夜",
        description:
        "暖色落地灯、深色木门、半掩窗帘与旧录音设备，走廊冷白灯从门缝切入，适合悬疑对峙。",
    };
    const cards = [actress, actor, scene];
    setAssets((all) => [...all, ...cards]);
    const next = names.map((n, i) =>
      stampShot(
        {
          ...newShot(shots.length + i, n, beats[i].action),
          promptFields: beats[i],
        },
        [...assets, ...cards],
      ),
    );
    const chained = next.map((s, i) => ({
      ...s,
      parentId: i === 0 ? undefined : next[i - 1].id,
      position: { x: i * 360, y: 40 },
    }));
    setShots((all) => [...all, ...chained]);
    setSelected(chained[0].id);
    setTone(DEFAULT_SCRIPT_TONE);
    setTitle("门关上之后");
    setStory(
      "26岁的林晚和29岁的周衡在酒店套房门口争执。门一关上，走廊里的脚步声停在门外，他们必须在暴露线索和保护彼此之间做选择。",
    );
  }
  return (
    <main className={`${styles.studio} ${embedded ? styles.embedded : ""}`}>
      <header className={styles.header}>
        {!embedded && <><Link href="/" className={styles.brand}>
          P<span>ENCIL</span>
            <small>短剧导演台</small>
        </Link>
        <Link href="/toonflow">Toonflow</Link></>}
        <input
          aria-label="剧名"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className={styles.saved}>{saving}</span>
        <button onClick={() => setSettings(!settings)}>
          {embedded ? "设置" : "连接设置"}{" "}
          {provider === "comfy" ? (gpu.ready ? "●" : "○") : key ? "●" : "○"}
        </button>
        <button disabled={archiveBusy || editLocked} onClick={download}>
          {archiveBusy ? "处理存档中…" : embedded ? "导出" : "下载存档 ↗"}
        </button>
        {!embedded && <Link href="/projects">项目库</Link>}
      </header>
      {embedded && <nav className={styles.mobilePanels} aria-label="工作台面板">
        {[["story", "剧本"], ["canvas", "画布"], ["inspector", "详情"]].map(([id, name]) => <button key={id} aria-pressed={mobilePanel === id} onClick={() => setMobilePanel(id)}>{name}</button>)}
      </nav>}
      <div className={styles.workspace} data-panel={mobilePanel}>
        <aside className={styles.story}>
          <h1>剧本创作</h1>
          {embedded ? <label className={styles.scriptModelPicker}>
            剧本模型
            <select aria-label="剧本模型" value={scriptModel} disabled={writing || !scriptModels.length} onChange={e => setScriptModel(e.target.value)}>
              {!scriptModels.length && <option value={scriptModel}>正在连接平台模型…</option>}
              {scriptModels.map(m => <option key={m.id} value={m.id} disabled={"availability" in m && !!m.availability}>{m.name}{"availability" in m && m.availability ? " · 地区受限" : ""}</option>)}
            </select>
            <small>使用平台积分 · 按实际 API 成本 ×2 计费</small>
          </label> : <button className={styles.agentModel} onClick={() => setSettings(true)}>
            {SCRIPT_MODELS.find(m => m.id === scriptModel)?.name ?? scriptModel} · 配置模型 ↗
          </button>}
          <label>
              剧情风格
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as ScriptTone)}
            >
              {TONE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>
              {TONE_OPTIONS.find((option) => option.id === tone)?.hint}
            </small>
          </label>
          <label>
            故事梗概
            <textarea
              placeholder="例如：两位调查员在雨夜收到同一封匿名信，沿着线索寻找失踪的证人……"
              value={story}
              onChange={(e) => setStory(e.target.value)}
              maxLength={12000}
            />
          </label>
          <button
            className={styles.primary}
            disabled={writing || !story.trim() || (embedded && !scriptModels.length)}
            onClick={write}
          >
            {writing ? "正在编写剧本…" : "生成剧本与分镜 ↗"}
          </button>
          <button onClick={example}>载入示例故事</button>
          <div className={styles.divider} />
          <details className={styles.promptSettings}>
            <summary>固定提示词</summary>
            <small>
              生成时自动拼进镜头 Prompt。镜头里写过的运镜、声音会覆盖这里的默认值。
            </small>
            {(
              [
                ["style", "成片风格"],
                ["camera", "默认运镜"],
                ["lighting", "光线"],
                ["audio", "默认声音"],
                ["negative", "项目负面词"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  value={promptSettings[key]}
                  maxLength={8000}
                  onChange={(e) =>
                    setPromptSettings((current) => ({
                      ...current,
                      [key]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </details>
          <div className={styles.divider} />
          <div className={styles.row}>
            <h2>素材与设定</h2>
            <span>{assets.length} 张卡片</span>
          </div>
          <div className={styles.assetActions}>
            <button onClick={() => addAsset("reference")}>＋ 参考卡</button>
            <button onClick={() => addAsset("scene")}>＋ 场景卡</button>
          </div>
          <div className={styles.shotList}>
            {assets.map((a) => (
              <button
                key={a.id}
                className={a.id === selected ? styles.active : ""}
                onClick={() => setSelected(a.id)}
              >
                <span>{a.kind === "scene" ? "⌂" : "◎"}</span>
                <strong>{a.title}</strong>
                <small>{a.kind === "scene" ? "场景" : "参考"}</small>
              </button>
            ))}
          </div>
          <div className={styles.divider} />
          <div className={styles.row}>
            <h2>镜头列表</h2>
            <span>
              {shots.length} 镜 /{" "}
              {shots.reduce((n, s) => n + (s.duration || 15), 0)}s
            </span>
          </div>
          <div className={styles.shotList}>
            {walkShotTree(shots).map((s, i) => (
              <button
                className={s.id === selected ? styles.active : ""}
                key={s.id}
                style={{ paddingLeft: 10 + shotDepth(shots, s.id) * 14 }}
                onClick={() => setSelected(s.id)}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{s.title}</strong>
                <small>
                  {shotChildren(shots, s.id).length > 1
                    ? `${shotChildren(shots, s.id).length} 支`
                    : labels[s.status || ""] || "草稿"}
                </small>
              </button>
            ))}
          </div>
          <button onClick={() => add(false)}>＋ 添加镜头</button>
          <button
            disabled={!shots.some((item) => item.id === selected)}
            onClick={() => add(true)}
          >
            ＋ 添加分支
          </button>
          <button
            disabled={archiveBusy || editLocked}
            onClick={() => importRef.current?.click()}
          >
            上传恢复存档
          </button>
          <button
            disabled={archiveBusy || editLocked || !vault}
            onClick={() => cloudArchives("save")}
          >
            存到远程存档
          </button>
          <button
            disabled={archiveBusy || !vault}
            onClick={() => cloudArchives("list")}
          >
            查看远程存档
          </button>
          {archiveList.map((item) => (
            <button
              key={item.id}
              disabled={archiveBusy || editLocked}
              onClick={() => {
                if (
                  window.confirm("恢复此存档将替换当前画布，请先下载当前创作。")
                )
                  void cloudArchives("load", item.id);
              }}
            >
              {item.title} · {new Date(item.savedAt).toLocaleString()}
            </button>
          ))}
          <input
            hidden
            ref={importRef}
            type="file"
            accept=".json,.zip"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (editLocked || archiveBusy) return;
              if (
                !window.confirm("恢复存档将替换当前创作，请先下载当前存档。")
              ) {
                e.target.value = "";
                return;
              }
              setArchiveBusy(true);
              try {
                const { doc } = await unpackArchive(f);
                openArchive(doc);
                setNotice("存档已恢复。");
              } catch (error) {
                setNotice(
                  error instanceof Error ? error.message : "无法读取存档",
                );
              } finally {
                setArchiveBusy(false);
              }
              e.target.value = "";
            }}
          />
        </aside>
        <section
          className={styles.canvas}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            const position = flowRef.current?.screenToFlowPosition({
              x: e.clientX,
              y: e.clientY,
            });
            if (position)
              void importImages(Array.from(e.dataTransfer.files), position);
          }}
        >
          <div className={styles.canvasBar}>
            <button onClick={undo} disabled={editLocked || !undoStack.current.length} title="⌘/Ctrl Z">撤销</button>
            <button onClick={redo} disabled={editLocked || !redoStack.current.length} title="⌘/Ctrl Shift Z">重做</button>
            <button onClick={() => add(false)} disabled={editLocked}>＋ 镜头</button>
            <span>
                  {gpu.ready ? "● GPU 已就绪" : "○ GPU 连接中"} · MiniMax H3
              {gpu.director ? " / 导演台" : ""}
            </span>
            <button
              hidden={!shots.length}
              disabled={batch || running || !shots.length}
              onClick={async () => {
                if (provider === "fal" && !key) {
                  setSettings(true);
                  return;
                }
                batchStop.current = false;
                setBatch(true);
                try {
                  for (const s of shots.filter(
                    (s) => !s.videoUrl && s.status !== "CHECK_FAILED",
                  )) {
                    if (batchStop.current) break;
                    await generate(s);
                  }
                } finally {
                  setBatch(false);
                }
              }}
            >
              生成未完成镜头
            </button>
            <button
              className={styles.stop}
              hidden={!running && !batch}
              disabled={!running && !batch}
              onClick={() => void stopAllGenerating()}
            >
              终止生成
            </button>
          </div>
          <details className={styles.editMenu} data-history={historyVersion}>
            <summary aria-label="画布操作">···</summary>
            <div className={styles.editBar}>
            <button
              onClick={() =>
                setSelection([...shots, ...assets].map((s) => s.id))
              }
            >
              全选
            </button>
            <button
              disabled={editLocked || !selectedIds.length}
              onClick={duplicateSelection}
              title="⌘/Ctrl D"
            >
              制作副本
            </button>
            <button disabled={!selectedIds.length} onClick={() => copySelection()}>复制</button>
            <button disabled={editLocked || !selectedIds.length || objectsBusy(selectedIds)} onClick={() => cutSelection()}>剪切</button>
            <button disabled={editLocked || !clipboard} onClick={() => pasteSelection()}>粘贴</button>
            <button
              disabled={editLocked || !selectedIds.length || selectionGenerating}
              onClick={removeSelection}
            >
              删除{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
            </button>
            <button
              disabled={editLocked || (!shots.length && !assets.length)}
              onClick={arrange}
            >
              整理布局
            </button>
            <button
              disabled={
                editLocked ||
                running ||
                imageBusyIds.length > 0 ||
                (!shots.length && !assets.length)
              }
              onClick={() => setClearDialog(true)}
            >
              清空画布
            </button>
          </div>
          </details>
          <div className={styles.canvasFlow}>
          <DramaCanvas
            shots={shots}
            assets={assets}
            selected={selected}
            selection={selection}
            imageBusyIds={imageBusyIds}
            editLocked={editLocked}
            gridVisible={gridVisible}
            snapToGrid={snapToGrid}
            onContextMenu={openContextMenu}
            onInspect={inspectObject}
            imageLocked={
              batch || writing || archiveBusy || uploadingImages
            }
            onInit={(instance) => {
              flowRef.current = instance;
              setCanvasZoom(instance.getZoom());
            }}
            onZoom={setCanvasZoom}
            onSelect={(id) => {
              closeContextMenu();
              setSelected(id);
              if (embedded) setMobilePanel("inspector");
            }}
            onPaneClick={() => {
              closeContextMenu();
              setSelected("");
              setSelection([]);
            }}
            onSelectionChange={ids => { setSelection(ids); setSelected(ids.at(-1) ?? ""); }}
            onConnect={connectShots}
            onUnlink={unlink}
            onDragBegin={() => checkpoint()}
            onCommitPositions={commitPositions}
            onDropImages={(id, files) => {
              const card = assets.find((item) => item.id === id);
              void importImages(files, card?.position || { x: 0, y: 0 }, id);
            }}
            onGenerateImage={(id) => {
              const card = assets.find((item) => item.id === id);
              if (card) void generateAssetImage(card);
            }}
          />
          {!shots.length && !assets.length && (
            <div className={styles.empty}>
              <h2>从第一个镜头开始</h2>
                <p>输入故事生成分镜，或直接添加镜头。</p>
              <button disabled={editLocked} onClick={() => add(false)}>＋ 创建第一个镜头</button>
            </div>
          )}
          </div>
          {shot && !multipleSelected && provider === "comfy" && (
            <TimelineDirectorDock
              shot={shot}
              assets={assets}
              seedPrompt={shotContext(shot, assets, tone, promptSettings).prompt}
              disabled={editLocked || isGenerating(shot)}
              generateBusy={uploadingMedia || imageBusyIds.includes(shot.id)}
              generateLabel={
                labels[shot.status || ""] &&
                shot.status !== "FAILED" &&
                shot.status !== "COMPLETED" &&
                shot.status !== "CHECK_FAILED"
                  ? labels[shot.status!]
                  : `${shot.videoUrl ? "重新" : ""}导演生成 ${directorOutputSeconds(directorOf(shot.timelineDirector, shot.duration))}s ↗`
              }
              canStop={canStopGeneration(shot)}
              onGenerate={() => generate(shot)}
              onStop={() => void stopGenerate(shot)}
              onChange={(timelineDirector, duration, extras) => {
                const next = {
                  ...shot,
                  timelineDirector,
                  ...(duration ? { duration } : {}),
                  ...(extras?.referenceBindings
                    ? { referenceBindings: extras.referenceBindings }
                    : {}),
                  ...(timelineDirector.enabled
                    ? { videoModel: "h3" as const, modelPick: shot.modelPick }
                    : {}),
                };
                patch(shot.id, {
                  timelineDirector,
                  ...(duration ? { duration } : {}),
                  ...(extras?.referenceBindings
                    ? { referenceBindings: extras.referenceBindings }
                    : {}),
                  ...(shot.modelPick === "manual" ||
                  next.videoModel === shot.videoModel
                    ? {}
                    : planFromShot(next, assets, tone, gpu)),
                });
              }}
              onBusy={setUploadingMedia}
              onError={setNotice}
            />
          )}
        </section>
        <aside
          className={styles.inspector}
          ref={inspectorRef}
          data-selected={Boolean(selectedCards.length)}
          style={{ zoom: inspectorScale }}
        >

          <details className={styles.optionalSettings}>
            <summary>显示设置</summary>
          <div className={styles.zoomBar}>
            <span>画布 {Math.round(canvasZoom * 100)}%</span>
            <button
              type="button"
              aria-label="画布缩小"
              onClick={() => {
                flowRef.current?.zoomOut();
                requestAnimationFrame(() =>
                  setCanvasZoom(flowRef.current?.getZoom() || 0.65),
                );
              }}
            >
              −
            </button>
            <button
              type="button"
              aria-label="画布放大"
              onClick={() => {
                flowRef.current?.zoomIn();
                requestAnimationFrame(() =>
                  setCanvasZoom(flowRef.current?.getZoom() || 0.65),
                );
              }}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                flowRef.current?.fitView({ padding: 0.24, duration: 200 });
                requestAnimationFrame(() =>
                  setCanvasZoom(flowRef.current?.getZoom() || 0.65),
                );
              }}
            >
              适应
            </button>
            <span>面板</span>
            <button
              type="button"
              aria-label="缩小检查器"
              onClick={() => {
                const next = Math.max(0.85, Math.round((inspectorScale - 0.15) * 100) / 100);
                setInspectorScale(next);
                localStorage.setItem("pencil.drama.inspectorScale", String(next));
              }}
            >
              A−
            </button>
            <button
              type="button"
              aria-label="放大检查器"
              onClick={() => {
                const next = Math.min(1.3, Math.round((inspectorScale + 0.15) * 100) / 100);
                setInspectorScale(next);
                localStorage.setItem("pencil.drama.inspectorScale", String(next));
              }}
            >
              A+
            </button>
          </div>
          </details>
          <h2>
            {multipleSelected ? "对象属性" : asset
              ? asset.kind === "scene"
                ? "场景设定"
                : "角色与参考"
              : "镜头设置"}
          </h2>
          <ObjectProperties
            cards={selectedCards}
            disabled={editLocked}
            onPosition={(id, position) => { checkpoint(true); commitPositions([{ id, position }]); }}
            onLock={locked => lockObjects(selectedIds, locked)}
            onAlign={alignment => alignObjects(selectedIds, alignment)}
            onMenu={screen => openContextMenu({ kind: "node", id: selectedIds[0], screen, flow: selectedCards[0]?.position ?? { x: 0, y: 0 } })}
          />
          {multipleSelected ? <p className={styles.muted}>对齐与位置锁定会应用于所有选中对象。单独选择对象可编辑内容。</p> : asset ? (
            <>
              <label>
                卡片名称
                <input
                  value={asset.title}
                  onChange={(e) =>
                    patchAsset(asset.id, { title: e.target.value })
                  }
                />
              </label>
              <label>
                {asset.kind === "scene"
                  ? "空间、道具、光线与氛围"
                  : "年龄、外观、服装与性格"}
                <textarea
                  value={asset.description}
                  onChange={(e) =>
                    patchAsset(asset.id, { description: e.target.value })
                  }
                  maxLength={2000}
                />
              </label>
              <details className={styles.optionalSettings} key={`negative-${asset.id}`}>
                <summary>负面提示词（可选）</summary>
              <div className={styles.negativeField}>
                <span className={styles.fieldHead}>
                  <label htmlFor="asset-negative">避免出现的内容（Negative）</label>
                </span>
                <textarea
                  id="asset-negative"
                  value={
                    isCannedNegative(asset.negativePrompt)
                      ? ""
                      : (asset.negativePrompt ?? "")
                  }
                  maxLength={1600}
                  placeholder="例如：无多余手指、无油腻皮肤、无文字水印"
                  onChange={(e) =>
                    patchAsset(asset.id, { negativePrompt: e.target.value })
                  }
                />
              </div>              </details>

              <small>
                以文字约束加入生图；效果取决于模型。
              </small>
              <button
                disabled={editLocked}
                onClick={() => uploadRef.current?.click()}
              >
                {uploadingImages
                  ? "导入图片中…"
                  : "选择本地图片（也可拖到卡片上）"}
              </button>
              <input
                ref={uploadRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length)
                    void importImages(files, asset.position, asset.id);
                  e.target.value = "";
                }}
              />
              <label>
                参考图片 URL
                <input
                  type="url"
                  placeholder="https://…"
                  value={asset.imageUrl}
                  onChange={(e) =>
                    patchAsset(asset.id, { imageUrl: e.target.value })
                  }
                />
              </label>
              <label>
                生图模型
                <select
                  value={imageModel}
                  onChange={(e) => {
                    const next = parseImageModel(e.target.value);
                    setImageModel(next);
                    localStorage.setItem("pencil.drama.imageModel", next);
                  }}
                >
                  {IMAGE_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={batch || writing || archiveBusy}
                onClick={() => void generateAssetImage(asset)}
              >
                {imageBusyIds.includes(asset.id)
                  ? "生图中 · 再点一张"
                  : `用 ${imageModelShortLabel(imageModel)} 生成 1K`}
              </button>
              {asset.kind === "reference" && (
                <button
                  disabled={
                    batch ||
                    writing ||
                    archiveBusy ||
                    !asset.imageUrl.trim()
                  }
                  onClick={() => void generateAssetThreeView(asset)}
                >
                  {imageBusyIds.includes(asset.id)
                    ? "三视图生成中…"
                    : "生成三视图 · 正面 / 侧面 / 背面"}
                </button>
              )}
              <p className={styles.muted}>
                {asset.kind === "reference"
                  ? "默认 1K 单人设定图。需要正面/侧面/背面时再点三视图（2K）。连点会再出一张新卡。"
                  : "连点会同时发出多次请求；同一张卡再点会在旁边再出一张。有图时自动改走 H3 参考模式。"}
              </p>
              <div className={styles.bindings}>
                {shots.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={(s.assetIds || []).includes(asset.id)}
                      onChange={(e) =>
                        patch(
                          s.id,
                          e.target.checked
                            ? attachAssets(
                                {
                                  ...s,
                                  assetIds: [...(s.assetIds || []), asset.id],
                                },
                                assets,
                              )
                            : unbindAsset(s, asset.id),
                        )
                      }
                    />
                    {s.title}
                  </label>
                ))}
              </div>
              <button disabled={editLocked} onClick={duplicateSelection}>
                复制卡片
              </button>
              <button
                disabled={editLocked || selectionGenerating}
                onClick={removeSelection}
              >
                删除卡片
              </button>
            </>
          ) : shot ? (
            <>
              <label>
                镜头名称
                <input
                  value={shot.title}
                  onChange={(e) => patch(shot.id, { title: e.target.value })}
                />
              </label>
              <ReferencePrompt
                key={`prompt-${shot.id}`}
                shot={shot}
                assets={assets}
                value={visibleShotPrompt(shot)}
                disabled={editLocked || isGenerating(shot)}
                onChange={(p) => {
                  patch(shot.id, {
                    ...parseLabeledShotPrompt(
                      p.prompt ?? visibleShotPrompt(shot),
                    ),
                    ...(p.referenceBindings
                      ? { referenceBindings: p.referenceBindings }
                      : {}),
                  });
                }}
              />
              {shot.timelineDirector?.enabled && (
                <p className={styles.directorHint}>
                  导演台已开启：生成用导演台上的提示词。右侧这栏只用来起草；点导演台里的「从镜头填入」才会带过去。
                </p>
              )}
              <details className={styles.optionalSettings} key={`negative-${shot.id}`}>
                <summary>负面提示词（可选）</summary>
              <div className={styles.negativeField}>
                <span className={styles.fieldHead}>
                  <label htmlFor="shot-negative">避免出现的内容（Negative）</label>
                </span>
                <textarea
                  id="shot-negative"
                  value={
                    isCannedNegative(shot.negativePrompt)
                      ? ""
                      : (shot.negativePrompt ?? "")
                  }
                  maxLength={1600}
                  placeholder="例如：无画面闪烁、无面容突变、无口型错位"
                  onChange={(e) =>
                    patch(shot.id, { negativePrompt: e.target.value })
                  }
                />
              </div>
              </details>

              <div className={styles.shotMeta}>
                <label>
                  生成模式
                  <select
                    value={shot.mode}
                    disabled={[
                      "IN_QUEUE",
                      "IN_PROGRESS",
                      "SUBMITTING",
                      "CHECK_FAILED",
                    ].includes(shot.status || "")}
                    onChange={(e) =>
                      patch(shot.id, { mode: e.target.value as DramaMode })
                    }
                  >
                    <option
                      value="t2v"
                      disabled={
                        provider === "comfy" && shot.videoModel === "ltx-10eros"
                      }
                    >
                      T2V
                    </option>
                    <option
                      value="i2v"
                      disabled={
                        provider === "comfy" && shot.videoModel === "ltx-sulphur"
                      }
                    >
                      I2V
                    </option>
                    <option
                      value="ri2v"
                      disabled={
                        provider === "comfy" &&
                        isLtxFamily(shot.videoModel) &&
                        !ltxSupportsRi2v(shot.videoModel)
                      }
                    >
                      RI2V
                    </option>
                  </select>
                </label>
                {provider === "comfy" && (
                  <label>
                    视频模型
                    <select
                      value={
                        shot.modelPick === "manual"
                          ? validateGpuModel(shot.videoModel ?? "h3")
                          : "auto"
                      }
                      disabled={editLocked || isGenerating(shot)}
                      onChange={(e) => {
                        if (e.target.value === "auto") {
                          const plan = planFromShot(
                            { ...shot, modelPick: "auto" },
                            assets,
                            tone,
                            gpu,
                          );
                          patch(shot.id, { modelPick: "auto", ...plan });
                          return;
                        }
                        patch(shot.id, {
                          modelPick: "manual",
                          videoModel: e.target.value as GpuVideoModel,
                          ...(e.target.value === "ltx-10eros"
                            ? {
                                mode: "i2v",
                                duration: clampLtxDuration(shot.duration),
                                lastFrame: "",
                              }
                            : e.target.value === "ltx-sulphur"
                              ? {
                                  mode: "t2v",
                                  duration: clampLtxDuration(shot.duration),
                                  lastFrame: "",
                                }
                              : e.target.value === "ltx-pinkcherry25"
                                ? {
                                    mode: shot.firstFrame ? "i2v" : "t2v",
                                    duration: clampLtxDuration(shot.duration),
                                    lastFrame: "",
                                  }
                              : { duration: parseShotDuration(shot.duration) }),
                        });
                      }}
                    >
                      <option value="auto">自动选择</option>
                      {shot.modelPick === "manual" && shot.videoModel &&
                        !STUDIO_VIDEO_MODELS.some(model => model.id === shot.videoModel) && (
                          <option value={shot.videoModel} disabled>旧模型入口已暂停</option>
                        )}
                      {STUDIO_VIDEO_MODELS.map((model) => (
                        <option
                          key={model.id}
                          value={model.id}
                          disabled={
                            !model.available ||
                            (model.id === "ltx-10eros" && !gpu.ltx?.ready) ||
                            (model.id === "ltx-sulphur" &&
                              !(gpu.ltx?.ready && gpu.ltx?.t2v)) ||
                            (model.id === "ltx-pinkcherry25" &&
                              !(gpu.ltx?.ready && gpu.ltx?.pinkcherry))
                          }
                        >
                          {model.label}
                          {model.id === "ltx-10eros" && !gpu.ltx?.ready
                            ? "（服务未就绪）"
                            : model.id === "ltx-sulphur" &&
                                !(gpu.ltx?.ready && gpu.ltx?.t2v)
                              ? "（T2V 未就绪）"
                              : model.id === "ltx-pinkcherry25" &&
                                  !(gpu.ltx?.ready && gpu.ltx?.pinkcherry)
                                ? "（服务未就绪）"
                              : model.id === "h3"
                                ? "（默认）"
                                : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className={styles.model}>
                {provider === "comfy"
                  ? `${shot.modelPick === "manual" ? "手动" : "自动"} · ${
                      shot.videoModel === "ltx-sulphur"
                        ? "Sulphur 2 · 512P"
                        : shot.videoModel === "ltx-10eros"
                          ? "10Eros · 512P"
                          : shot.videoModel === "ltx-pinkcherry25"
                            ? "PinkCherry · LTX-2.5"
                          : gpuModelLabel(shot.videoModel)
                    }`
                  : shot.mode === "ri2v"
                    ? "H3 Max · Reference"
                    : "H3 Max Turbo"}
              </p>
              <details className={styles.shotExtras}>
                <summary>关联参考与场景</summary>
                <div className={styles.bindings}>
                  {assets.length ? (
                    assets.map((a) => (
                      <label key={a.id}>
                        <input
                          type="checkbox"
                          checked={(shot.assetIds || []).includes(a.id)}
                          onChange={(e) =>
                            patch(
                              shot.id,
                              e.target.checked
                                ? attachAssets(
                                    {
                                      ...shot,
                                      assetIds: [
                                        ...(shot.assetIds || []),
                                        a.id,
                                      ],
                                    },
                                    assets,
                                  )
                                : unbindAsset(shot, a.id),
                            )
                          }
                        />
                        {a.title}
                      </label>
                    ))
                  ) : (
                    <small>在左侧添加参考卡或场景卡。</small>
                  )}
                </div>
              </details>
              {usesImageToVideo(shot) && (
                <>
                  <label>
                    I2V 首帧
                    {shot.firstFrame ? (
                      <img
                        className={styles.still}
                        src={shot.firstFrame}
                        alt=""
                      />
                    ) : null}
                    <input
                      type="url"
                      value={shot.firstFrame}
                      disabled={isGenerating(shot)}
                      onChange={(e) =>
                        patch(shot.id, { firstFrame: e.target.value })
                      }
                      placeholder="https:// 或先点下方生成首帧图"
                    />
                  </label>
                  <button
                    disabled={
                      imageBusyIds.includes(shot.id) ||
                      isGenerating(shot) ||
                      batch ||
                      writing ||
                      archiveBusy ||
                      !visibleShotPrompt(shot).trim()
                    }
                    onClick={() => void generateShotStill(shot)}
                  >
                    {imageBusyIds.includes(shot.id)
                      ? "首帧生图中…"
                      : shot.firstFrame
                        ? "重新生成首帧图 · 1K"
                        : "生成首帧图 · I2V 必需"}
                  </button>
                  <small>
                    10Eros / I2V 必须先有一张开始瞬间的静帧。点生成，或用上一镜留下的尾帧。
                  </small>
                  <label>
                    从参考卡选择首帧
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          patch(shot.id, { firstFrame: e.target.value });
                      }}
                    >
                      <option value="">选择一张参考图…</option>
                      {assets
                        .filter((a) => a.imageUrl)
                        .map((a) => (
                          <option key={a.id} value={a.imageUrl}>
                            {a.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    目标尾帧 URL（H3 可选）
                    <input
                      type="url"
                      disabled={
                        provider === "comfy" && isLtxFamily(shot.videoModel)
                      }
                      value={shot.lastFrame}
                      onChange={(e) =>
                        patch(shot.id, { lastFrame: e.target.value })
                      }
                      placeholder="https://…"
                    />
                  </label>
                </>
              )}
              {(shot.endStill || shot.videoUrl) && (
                <label>
                  成片尾帧素材
                  {shot.endStill ? (
                    <img className={styles.still} src={shot.endStill} alt="" />
                  ) : (
                    <small>成片完成后会自动抽取最后一帧，并接到下一镜首帧。</small>
                  )}
                </label>
              )}
              {shot.mode === "ri2v" && (
                <label>
                  参考图 URL（每行一张，最多 9 张）
                  <textarea
                    value={shot.references}
                    onChange={(e) =>
                      patch(shot.id, { references: e.target.value })
                    }
                    placeholder="https://…/character.jpg"
                  />
                  <small>
                    提示词中用 Image 1、Image 2 指定角色与场景。官方 MiniMax H3 走参考图节点。
                  </small>
                </label>
              )}
              {provider === "comfy" && (
                <details className={styles.optionalSettings} key={`media-${shot.id}`}>
                  <summary>音视频参考（可选）{shot.referenceMedia?.length ? ` · ${shot.referenceMedia.length}` : ""}</summary>
                <ReferenceMediaEditor
                  key={shot.id}
                  items={shot.referenceMedia || []}
                  bindings={shot.referenceBindings}
                  disabled={editLocked || isGenerating(shot)}
                  onChange={(referenceMedia) => {
                    const next = { ...shot, referenceMedia };
                    const mentions = ensureMentions(next, assets);
                    patch(shot.id, {
                      referenceMedia,
                      ...mentions,
                      ...(shot.modelPick === "manual"
                        ? {}
                        : planFromShot({ ...next, ...mentions }, assets, tone, gpu)),
                    });
                  }}
                  onBusy={setUploadingMedia}
                  onError={setNotice}
                />
                </details>

              )}
              {shot.referenceMedia?.some((m) => m.kind === "audio") &&
                !(shot.assetIds || []).some(
                  (id) => assets.find((a) => a.id === id)?.imageUrl,
                ) &&
                !shot.referenceMedia.some((m) => m.kind === "video") && (
                  <p className={styles.error}>
                    音频参考需要同时绑定角色图或视频；生成时会走 H3 参考模式。
                  </p>
                )}
              {(shot.mode !== "i2v" ||
                (provider === "comfy" && isLtxFamily(shot.videoModel))) && (
                <label>
                  项目画幅
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                  >
                    <option value="9:16">9:16 竖屏短剧</option>
                    <option value="16:9">16:9 横屏</option>
                    <option value="1:1">1:1 方形</option>
                  </select>
                </label>
              )}
              <div className={styles.generateBar}>
                <div className={styles.durationControl}>
                  <label className={styles.durationSlider}>
                    <span>
                      时长{" "}
                      {shot.timelineDirector?.enabled
                        ? directorOutputSeconds(
                            directorOf(shot.timelineDirector, shot.duration),
                          )
                        : parseShotDuration(shot.duration)}
                      s
                    </span>
                    <FilmScrubber
                      min={
                        shot.timelineDirector?.enabled
                          ? DIRECTOR_DURATION_MIN
                          : LTX_DURATION_MIN
                      }
                      max={
                        shot.timelineDirector?.enabled
                          ? DIRECTOR_DURATION_MAX
                          : LTX_DURATION_MAX
                      }
                      value={
                        shot.timelineDirector?.enabled
                          ? directorOutputSeconds(
                              directorOf(shot.timelineDirector, shot.duration),
                            )
                          : parseShotDuration(shot.duration)
                      }
                      disabled={isGenerating(shot)}
                      ariaLabel="镜头时长（秒）"
                      marks={
                        shot.timelineDirector?.enabled
                          ? directorOf(
                              shot.timelineDirector,
                              shot.duration,
                            ).segments.map((segment) =>
                              Math.round(segment.startFrame / 24),
                            )
                          : []
                      }
                      onChange={(value) => setShotDuration(shot, value)}
                    />
                  </label>
                </div>
                {shot.timelineDirector?.enabled ? (
                  <p className={styles.directorHint}>
                    请用画布下方导演台里的「导演生成」按钮。
                  </p>
                ) : (
                  <>
                    <button
                      className={styles.primary}
                      disabled={
                        !visibleShotPrompt(shot).trim() ||
                        uploadingMedia ||
                        imageBusyIds.includes(shot.id) ||
                        canStopGeneration(shot)
                      }
                      onClick={() => generate(shot)}
                    >
                      {labels[shot.status || ""] &&
                      shot.status !== "FAILED" &&
                      shot.status !== "COMPLETED" &&
                      shot.status !== "CHECK_FAILED"
                        ? labels[shot.status!]
                        : shot.videoUrl
                          ? `重新生成 ${shot.duration || 15}s`
                          : usesImageToVideo(shot) && !shot.firstFrame
                            ? `先出首帧再生成`
                            : `生成 ${shot.duration || 15}s ↗`}
                    </button>
                    {canStopGeneration(shot) && (
                      <button
                        type="button"
                        className={styles.stop}
                        onClick={() => void stopGenerate(shot)}
                      >
                        终止生成
                      </button>
                    )}
                  </>
                )}
              </div>
              <small>
                {shot.timelineDirector?.enabled
                  ? "请在下方导演台生成。导演台可拖到 60 秒；多段会按重叠做 H3 latent 续写。"
                  : planFromShot(shot, assets, tone, gpu).reason + " 3–15 秒可拖选。"}
              </small>
              <GenerationStatus shot={shot} />
              {shot.status === "CHECK_FAILED" && (
                <button
                  onClick={() =>
                    patch(shot.id, { status: "IN_QUEUE", error: undefined })
                  }
                >
                  继续查询已有任务（不重新生成）
                </button>
              )}
              {shot.taskId && (
                <small>
                  任务：{shot.taskId} ·{" "}
                  {shot.taskVideoModel === "ltx-sulphur"
                    ? "Sulphur 2"
                    : shot.taskVideoModel === "ltx-10eros"
                      ? "10Eros LTX"
                      : shot.taskVideoModel === "ltx-pinkcherry25"
                        ? "PinkCherry LTX-2.5"
                      : "10Eros-Max"}
                </small>
              )}
              {shot.videoUrl && (
                <a href={shot.videoUrl} target="_blank" rel="noreferrer">
                  打开 / 下载视频 ↗
                </a>
              )}
              <div className={styles.assetActions}>
                <button
                  disabled={editLocked || shotSiblingIndex <= 0}
                  onClick={() => {
                    checkpoint();
                    setShots((all) => moveShotAmongSiblings(all, shot.id, -1));
                  }}
                >
                  同级上移
                </button>
                <button
                  disabled={
                    editLocked ||
                    shotSiblingIndex < 0 ||
                    shotSiblingIndex >= shotSiblings.length - 1
                  }
                  onClick={() => {
                    checkpoint();
                    setShots((all) => moveShotAmongSiblings(all, shot.id, 1));
                  }}
                >
                  同级下移
                </button>
              </div>
              <button disabled={editLocked} onClick={duplicateSelection}>
                复制镜头
              </button>
              <button
                disabled={editLocked || selectionGenerating}
                onClick={removeSelection}
              >
                删除镜头
              </button>
            </>
          ) : (
            <p className={styles.muted}>选择画布上的镜头，编辑生成内容。</p>
          )}
        </aside>
      </div>
      {contextMenu && <CanvasContextMenu point={contextMenu.screen} title={contextMenu.kind === "pane" ? "画布操作" : contextMenu.kind === "edge" ? "镜头连线" : contextMenu.ids.length > 1 ? `${contextMenu.ids.length} 个对象` : "对象操作"} items={contextItems(contextMenu)} onClose={closeContextMenu} />}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
          <button aria-label="关闭通知" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {clearDialog && (
        <div className={styles.overlay}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <h2 id="clear-title">清空画布？</h2>
            <p>
              移除 {shots.length} 个镜头和 {assets.length}{" "}
              张设定卡，保留故事梗概与连接设置。清空后可以撤销；不会删除 GPU
              上的视频文件。
            </p>
            <button onClick={() => setClearDialog(false)}>取消</button>
            <button
              className={styles.primary}
              disabled={editLocked || running || imageBusyIds.length > 0}
              onClick={() => {
                checkpoint();
                restore({ shots: [], assets: [] });
                setClearDialog(false);
                setNotice("画布已清空，可点击撤销恢复。");
              }}
            >
              确认清空
            </button>
          </section>
        </div>
      )}
      {settings && (
        <div className={styles.overlay}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className={styles.dialog}
          >
            <div className={styles.row}>
              <h2 id="settings-title">模型与连接设置</h2>
              <button
                aria-label="关闭连接设置"
                onClick={() => setSettings(false)}
              >
                ×
              </button>
            </div>
            <h3>远程存档库</h3>
            <label>
              存档库恢复码（换设备时填写同一码）
              <input
                type="password"
                value={vault}
                onChange={(e) => setVault(e.target.value)}
                onBlur={() => {
                  if (/^[0-9a-f-]{36}$/.test(vault))
                    localStorage.setItem("pencil.archive.vault", vault);
                }}
              />
            </label>
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(vault)
                  .then(() => setNotice("存档库恢复码已复制，请妥善保存。"))
              }
            >
              复制恢复码
            </button>
            <h3>参考图</h3>
            <label>
              生图模型
              <select
                value={imageModel}
                onChange={(e) => {
                  const next = parseImageModel(e.target.value);
                  setImageModel(next);
                  localStorage.setItem("pencil.drama.imageModel", next);
                }}
              >
                {IMAGE_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {!isLocalFluxModel(imageModel) && (
              <label>
                {imageModel === GROK_IMAGE_MODEL
                  ? "OpenRouter 生图密钥"
                  : "火山生图密钥"}
                <input
                  type="password"
                  autoComplete="off"
                  value={imageKey}
                  onChange={(e) => setImageKey(e.target.value)}
                  placeholder={
                    imageModel === GROK_IMAGE_MODEL
                      ? "留空复用剧本 OpenRouter 密钥或服务器配置"
                      : "填写火山 API Key"
                  }
                />
              </label>
            )}
            <p>
              默认使用 Grok Image 生成 1K；三视图可选 2K。绑定参考图后官方 MiniMax H3 走 Ref2V。
            </p>
            <h3>Qwen Image 2.1 · Heretic</h3>
            <p>
              独立 GPU 文本编码服务，用来把画面想法整理成 Qwen Image 提示词；它不是 H3 视频模型。
            </p>
            <textarea
              value={qwenPrompt}
              onChange={(e) => setQwenPrompt(e.target.value)}
              placeholder="输入画面想法，例如：雨夜酒店走廊，人物从远处走来…"
              rows={4}
            />
            <button type="button" onClick={requestQwenPrompt} disabled={qwenBusy}>
              {qwenBusy ? "Qwen 处理中…" : "用 Qwen 整理提示词"}
            </button>
            {qwenResult && (
              <textarea
                value={qwenResult}
                onChange={(e) => setQwenResult(e.target.value)}
                aria-label="Qwen Image 提示词结果"
                rows={5}
              />
            )}
            {!embedded && <>
            <h3>剧本模型</h3>
            <label>
              文本服务
              <select
                value={scriptProvider}
                onChange={(e) => {
                  setScriptProvider(e.target.value);
                  if (e.target.value === "xai") setScriptModel(DEFAULT_SCRIPT_MODEL);
                  setScriptKey("");
                }}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="xai">xAI 官方</option>
              </select>
            </label>
            <label>
              文本模型
              <select
                value={scriptModel}
                onChange={(e) => setScriptModel(e.target.value as string)}
              >
                {SCRIPT_MODELS.filter(m => scriptProvider !== "xai" || m.id.startsWith("grok-")).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label>
              {scriptProvider === "xai" ? "xAI" : "OpenRouter"} API Key
              <input
                type="password"
                autoComplete="off"
                value={scriptKey}
                onChange={(e) => setScriptKey(e.target.value)}
                placeholder="填写密钥；留空时使用服务端配置"
              />
            </label>
            <small>
              密钥保留在当前页面内存，刷新后清除，不写入项目。请求通过本站服务端转发至所选平台。
            </small>
            </>}
            <div className={styles.divider} />
            <label>
              生成服务
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as "comfy" | "fal")}
              >
                <option value="comfy">自有 GPU · ComfyUI</option>
                <option value="fal">fal.ai · H3 Max Turbo</option>
              </select>
            </label>
            {provider === "comfy" && (
              <div>
                <p>
                  {gpu.connected
                    ? gpu.ready
                      ? "GPU 已就绪，可以生成。"
                      : "GPU 已连接，模型权重准备中。"
                    : "GPU 离线，请检查远程实例与服务连接。"}
                </p>
                <small>
                  RTX 4090 D · 官方 MiniMax H3（含 T2V / I2V / Ref2V / 时间线导演台）。
                </small>
                {gpu.models && (
                  <ul>
                    {Object.values(gpu.models).map((m) => (
                      <li key={m.name}>
                        <small>
                          {m.available ? "✓" : "等待"} {m.name}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href="http://127.0.0.1:6106"
                  target="_blank"
                  rel="noreferrer"
                >
                  打开 ComfyUI ↗
                </a>
              </div>
            )}
            {provider === "fal" && (
              <label>
                fal.ai API Key
                <input
                  autoFocus
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="填写后启用视频生成"
                  autoComplete="off"
                />
              </label>
            )}
            <small>视频密钥与剧本密钥独立设置，不写入项目或本地存储。</small>
            <button
              className={styles.primary}
              onClick={() => setSettings(false)}
            >
              完成
            </button>
            {provider === "fal" && (
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noreferrer"
              >
                获取 fal.ai 密钥 ↗
              </a>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
