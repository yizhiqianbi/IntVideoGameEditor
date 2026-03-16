import { MarkerType, type Edge, type Node, type XYPosition } from "@xyflow/react";
import {
  DEFAULT_GENERATION_CONFIG,
  DEFAULT_PROVIDER_PRIORITY,
  type NodeGenerationConfig,
  type VideoProviderId,
} from "../../lib/video-generation";
import {
  DEFAULT_CHARACTER_IMAGE_MODEL,
  type ImageGenerationModel,
} from "../../lib/image-generation";

export const PROJECT_VERSION = 3;
export const VIDEO_SCENE_NODE_TYPE = "videoScene";
export const CHARACTER_REFERENCE_NODE_TYPE = "characterReference";
export const SCENE_REFERENCE_NODE_TYPE = "sceneReference";

export type AssetKind = "video" | "image";

export type AssetStatus =
  | "empty"
  | "ready"
  | "missing"
  | "unsupported"
  | "generated"
  | "generating"
  | "failed";

export type AssetRef = {
  assetId: string;
  fileName: string;
  mimeType?: string;
  kind: AssetKind;
};

export type CharacterDefinition = {
  id: string;
  name: string;
  bio: string;
  basePrompt: string;
  imageModel: ImageGenerationModel;
  referenceImageAssetRefs: AssetRef[];
  placeholderUrl?: string;
  canvasPosition: XYPosition;
};

export type SceneDefinition = {
  id: string;
  name: string;
  description: string;
  basePrompt: string;
  imageModel: ImageGenerationModel;
  referenceImageAssetRefs: AssetRef[];
  placeholderUrl?: string;
  canvasPosition: XYPosition;
};

export type SceneAction = {
  id: string;
  characterId: string;
  action: string;
  emotion: string;
  dialogue: string;
};

export type TrimRange = {
  startMs: number;
  endMs?: number;
};

export type NodeGenerationTask = {
  providerId: VideoProviderId;
  taskId: string;
  status: "idle" | "queued" | "processing" | "succeeded" | "failed";
  rawStatus?: string;
  errorMessage?: string;
  submittedAt: string;
};

export type VideoSceneNodeData = {
  title: string;
  shotNotes: string;
  actions: SceneAction[];
  assetRef?: AssetRef;
  generatedVideoUrl?: string;
  generatedCoverUrl?: string;
  previewUrl?: string;
  assetError?: string;
  assetStatus: AssetStatus;
  trim: TrimRange;
  generation: NodeGenerationConfig;
  generationTask?: NodeGenerationTask;
  onTitleChange?: (nodeId: string, title: string) => void;
};

export type EditorFlowNode = Node<
  VideoSceneNodeData,
  typeof VIDEO_SCENE_NODE_TYPE
>;

export type TransitionEdgeData = {
  conditionVariable: string;
  choiceLabel?: string;
};

export type EditorFlowEdge = Edge<TransitionEdgeData>;

export type ProjectSettings = {
  providerPriority: VideoProviderId[];
};

export type SerializedEditorNode = {
  id: string;
  type: typeof VIDEO_SCENE_NODE_TYPE;
  position: XYPosition;
  data: {
    title: string;
    shotNotes: string;
    actions: SceneAction[];
    assetRef?: AssetRef;
    generatedVideoUrl?: string;
    generatedCoverUrl?: string;
    trim: TrimRange;
    generation: NodeGenerationConfig;
    generationTask?: NodeGenerationTask;
  };
};

export type SerializedEditorEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  animated?: boolean;
  conditionVariable?: string;
  choiceLabel?: string;
};

export type EditorProject = {
  version: number;
  nodes: SerializedEditorNode[];
  edges: SerializedEditorEdge[];
  characters: CharacterDefinition[];
  scenes: SceneDefinition[];
  settings: ProjectSettings;
};

type UnknownRecord = Record<string, unknown>;
const ALL_VIDEO_PROVIDERS: VideoProviderId[] = [
  "doubao",
  "minimax",
  "vidu",
  "kling",
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isPosition(value: unknown): value is XYPosition {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function sanitizeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function sanitizeAssetRef(
  value: unknown,
  fallbackKind: AssetKind,
): AssetRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.assetId !== "string" || typeof value.fileName !== "string") {
    return undefined;
  }

  return {
    assetId: value.assetId,
    fileName: value.fileName,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
    kind: value.kind === "image" || value.kind === "video" ? value.kind : fallbackKind,
  };
}

function sanitizeSceneAction(value: unknown): SceneAction {
  if (!isRecord(value)) {
    throw new Error("动作结构无效。");
  }

  return {
    id:
      typeof value.id === "string" && value.id.trim().length > 0
        ? value.id
        : crypto.randomUUID(),
    characterId: sanitizeString(value.characterId),
    action: sanitizeString(value.action),
    emotion: sanitizeString(value.emotion),
    dialogue: sanitizeString(value.dialogue),
  };
}

function sanitizeTrimRange(value: unknown): TrimRange {
  if (!isRecord(value)) {
    return {
      startMs: 0,
    };
  }

  return {
    startMs:
      typeof value.startMs === "number" && Number.isFinite(value.startMs)
        ? Math.max(0, value.startMs)
        : 0,
    endMs:
      typeof value.endMs === "number" && Number.isFinite(value.endMs)
        ? Math.max(0, value.endMs)
        : undefined,
  };
}

function sanitizeGeneration(value: unknown): NodeGenerationConfig {
  if (!isRecord(value)) {
    return { ...DEFAULT_GENERATION_CONFIG };
  }

  const providerId =
    value.providerId === "auto" ||
    value.providerId === "doubao" ||
    value.providerId === "minimax" ||
    value.providerId === "vidu" ||
    value.providerId === "kling"
      ? value.providerId
      : DEFAULT_GENERATION_CONFIG.providerId;

  const mode =
    value.mode === "text-to-video" || value.mode === "image-to-video"
      ? value.mode
      : DEFAULT_GENERATION_CONFIG.mode;
  const aspectRatio =
    value.aspectRatio === "16:9" ||
    value.aspectRatio === "9:16" ||
    value.aspectRatio === "1:1"
      ? value.aspectRatio
      : DEFAULT_GENERATION_CONFIG.aspectRatio;
  const resolution =
    value.resolution === "720p" || value.resolution === "1080p"
      ? value.resolution
      : DEFAULT_GENERATION_CONFIG.resolution;

  return {
    providerId,
    mode,
    model: sanitizeString(value.model),
    aspectRatio,
    durationSec:
      typeof value.durationSec === "number" && Number.isFinite(value.durationSec)
        ? Math.max(3, Math.min(12, value.durationSec))
        : DEFAULT_GENERATION_CONFIG.durationSec,
    resolution,
    promptOverride: sanitizeString(value.promptOverride),
    referenceCharacterIds: Array.isArray(value.referenceCharacterIds)
      ? value.referenceCharacterIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
    referenceSceneIds: Array.isArray(value.referenceSceneIds)
      ? value.referenceSceneIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
  };
}

function sanitizeGenerationTask(value: unknown): NodeGenerationTask | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const providerId =
    value.providerId === "doubao" ||
    value.providerId === "minimax" ||
    value.providerId === "vidu" ||
    value.providerId === "kling"
      ? value.providerId
      : undefined;

  const status =
    value.status === "idle" ||
    value.status === "queued" ||
    value.status === "processing" ||
    value.status === "succeeded" ||
    value.status === "failed"
      ? value.status
      : undefined;

  if (!providerId || typeof value.taskId !== "string" || !status) {
    return undefined;
  }

  return {
    providerId,
    taskId: value.taskId,
    status,
    rawStatus: sanitizeString(value.rawStatus),
    errorMessage: sanitizeString(value.errorMessage),
    submittedAt:
      typeof value.submittedAt === "string" && value.submittedAt.trim().length > 0
        ? value.submittedAt
        : new Date().toISOString(),
  };
}

function sanitizeCharacter(value: unknown, index = 1): CharacterDefinition {
  if (!isRecord(value)) {
    throw new Error("角色结构无效。");
  }

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error("角色必须包含合法 ID。");
  }

  return {
    id: value.id.trim(),
    name:
      typeof value.name === "string" && value.name.trim().length > 0
        ? value.name.trim()
        : value.id.trim(),
    bio: sanitizeString(value.bio),
    basePrompt: sanitizeString(value.basePrompt),
    imageModel:
      value.imageModel === "doubao-seedream-5-0-260128" ||
      value.imageModel === "doubao-seedream-4-5-251128" ||
      value.imageModel === "doubao-seedream-4-0-250828" ||
      value.imageModel === "doubao-seedream-3-0-t2i-250415"
        ? value.imageModel
        : DEFAULT_CHARACTER_IMAGE_MODEL,
    referenceImageAssetRefs: Array.isArray(value.referenceImageAssetRefs)
      ? value.referenceImageAssetRefs
          .map((assetRef) => sanitizeAssetRef(assetRef, "image"))
          .filter((assetRef): assetRef is AssetRef => Boolean(assetRef))
      : [],
    placeholderUrl: sanitizeString(value.placeholderUrl) || undefined,
    canvasPosition: isPosition(value.canvasPosition)
      ? value.canvasPosition
      : { x: -320, y: 80 + Math.max(index - 1, 0) * 250 },
  };
}

function sanitizeSceneDefinition(value: unknown, index = 1): SceneDefinition {
  if (!isRecord(value)) {
    throw new Error("场景结构无效。");
  }

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error("场景必须包含合法 ID。");
  }

  return {
    id: value.id.trim(),
    name:
      typeof value.name === "string" && value.name.trim().length > 0
        ? value.name.trim()
        : `场景 ${index}`,
    description: sanitizeString(value.description),
    basePrompt: sanitizeString(value.basePrompt),
    imageModel:
      value.imageModel === "doubao-seedream-5-0-260128" ||
      value.imageModel === "doubao-seedream-4-5-251128" ||
      value.imageModel === "doubao-seedream-4-0-250828" ||
      value.imageModel === "doubao-seedream-3-0-t2i-250415"
        ? value.imageModel
        : DEFAULT_CHARACTER_IMAGE_MODEL,
    referenceImageAssetRefs: Array.isArray(value.referenceImageAssetRefs)
      ? value.referenceImageAssetRefs
          .map((assetRef) => sanitizeAssetRef(assetRef, "image"))
          .filter((assetRef): assetRef is AssetRef => Boolean(assetRef))
      : [],
    placeholderUrl: sanitizeString(value.placeholderUrl) || undefined,
    canvasPosition: isPosition(value.canvasPosition)
      ? value.canvasPosition
      : { x: -40, y: 80 + Math.max(index - 1, 0) * 250 },
  };
}

function sanitizeProviderPriority(value: unknown): VideoProviderId[] {
  const nextPriority: VideoProviderId[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        (item === "doubao" ||
          item === "minimax" ||
          item === "vidu" ||
          item === "kling") &&
        !nextPriority.includes(item)
      ) {
        nextPriority.push(item);
      }
    }
  }

  for (const providerId of ALL_VIDEO_PROVIDERS) {
    if (!nextPriority.includes(providerId)) {
      nextPriority.push(providerId);
    }
  }

  return nextPriority;
}

function sanitizeProjectSettings(value?: unknown): ProjectSettings {
  return {
    providerPriority: sanitizeProviderPriority(
      isRecord(value) ? value.providerPriority : undefined,
    ),
  };
}

function sanitizeNodeData(value: unknown): SerializedEditorNode["data"] {
  if (!isRecord(value)) {
    throw new Error("节点 data 结构无效。");
  }

  const title =
    typeof value.title === "string" && value.title.trim().length > 0
      ? value.title.trim()
      : "未命名片段";
  const shotNotes = sanitizeString(value.shotNotes);
  const actions = Array.isArray(value.actions)
    ? value.actions.map((action) => sanitizeSceneAction(action))
    : [];
  const assetRef = sanitizeAssetRef(value.assetRef, "video");
  const trim = sanitizeTrimRange(value.trim);
  const generation = sanitizeGeneration(value.generation);
  const generationTask = sanitizeGenerationTask(value.generationTask);

  return {
    title,
    shotNotes,
    actions,
    assetRef,
    generatedVideoUrl:
      typeof value.generatedVideoUrl === "string" &&
      value.generatedVideoUrl.trim().length > 0
        ? value.generatedVideoUrl
        : undefined,
    generatedCoverUrl:
      typeof value.generatedCoverUrl === "string" &&
      value.generatedCoverUrl.trim().length > 0
        ? value.generatedCoverUrl
        : undefined,
    trim,
    generation,
    generationTask,
  };
}

function sanitizeSerializedNode(value: unknown): SerializedEditorNode {
  if (!isRecord(value)) {
    throw new Error("节点结构无效。");
  }

  if (typeof value.id !== "string" || !isPosition(value.position)) {
    throw new Error("节点缺少合法的 id 或 position。");
  }

  if (value.type !== VIDEO_SCENE_NODE_TYPE) {
    throw new Error("当前仅支持 videoScene 节点类型。");
  }

  return {
    id: value.id,
    type: VIDEO_SCENE_NODE_TYPE,
    position: value.position,
    data: sanitizeNodeData(value.data),
  };
}

function sanitizeSerializedEdge(value: unknown): SerializedEditorEdge {
  if (!isRecord(value)) {
    throw new Error("连线结构无效。");
  }

  if (
    typeof value.id !== "string" ||
    typeof value.source !== "string" ||
    typeof value.target !== "string"
  ) {
    throw new Error("连线缺少合法的 id、source 或 target。");
  }

  return {
    id: value.id,
    source: value.source,
    target: value.target,
    sourceHandle:
      typeof value.sourceHandle === "string" || value.sourceHandle === null
        ? value.sourceHandle
        : undefined,
    targetHandle:
      typeof value.targetHandle === "string" || value.targetHandle === null
        ? value.targetHandle
        : undefined,
    type: typeof value.type === "string" ? value.type : undefined,
    animated: typeof value.animated === "boolean" ? value.animated : undefined,
    conditionVariable:
      typeof value.conditionVariable === "string"
        ? value.conditionVariable
        : undefined,
    choiceLabel:
      typeof value.choiceLabel === "string" && value.choiceLabel.trim().length > 0
        ? value.choiceLabel.trim()
        : undefined,
  };
}

function sanitizeConditionVariable(value: string | undefined) {
  const nextValue = value?.trim();

  if (!nextValue) {
    return undefined;
  }

  return nextValue;
}

function migrateVersionOneNode(value: unknown): SerializedEditorNode {
  if (!isRecord(value)) {
    throw new Error("旧版节点结构无效。");
  }

  if (typeof value.id !== "string" || !isPosition(value.position)) {
    throw new Error("旧版节点缺少合法的 id 或 position。");
  }

  if (value.type !== VIDEO_SCENE_NODE_TYPE) {
    throw new Error("当前仅支持 videoScene 节点类型。");
  }

  const data = isRecord(value.data) ? value.data : {};

  return {
    id: value.id,
    type: VIDEO_SCENE_NODE_TYPE,
    position: value.position,
    data: {
      title:
        typeof data.title === "string" && data.title.trim().length > 0
          ? data.title.trim()
          : "未命名片段",
      shotNotes: sanitizeString(data.description),
      actions: [],
      assetRef: sanitizeAssetRef(data.assetRef, "video"),
      trim: {
        startMs: 0,
      },
      generation: {
        ...DEFAULT_GENERATION_CONFIG,
      },
      generationTask: undefined,
      generatedVideoUrl: undefined,
      generatedCoverUrl: undefined,
    },
  };
}

export function createConditionVariable(index: number) {
  return `condition_${index}`;
}

export function createConditionLabel(
  conditionVariable: string,
  choiceLabel?: string,
) {
  if (choiceLabel && choiceLabel.trim().length > 0) {
    return `选项: ${choiceLabel.trim()}`;
  }

  return `条件: ${conditionVariable}`;
}

export function createSceneAction(overrides?: Partial<SceneAction>): SceneAction {
  return {
    id: crypto.randomUUID(),
    characterId: overrides?.characterId ?? "",
    action: overrides?.action ?? "",
    emotion: overrides?.emotion ?? "",
    dialogue: overrides?.dialogue ?? "",
  };
}

export function createCharacterDefinition(
  index: number,
  overrides?: Partial<CharacterDefinition>,
): CharacterDefinition {
  return {
    id: overrides?.id ?? `character_${index}`,
    name: overrides?.name ?? `角色 ${index}`,
    bio: overrides?.bio ?? "",
    basePrompt: overrides?.basePrompt ?? "",
    imageModel: overrides?.imageModel ?? DEFAULT_CHARACTER_IMAGE_MODEL,
    referenceImageAssetRefs: overrides?.referenceImageAssetRefs ?? [],
    placeholderUrl: overrides?.placeholderUrl,
    canvasPosition: overrides?.canvasPosition ?? {
      x: -320,
      y: 80 + Math.max(index - 1, 0) * 250,
    },
  };
}

export function createSceneDefinition(
  index: number,
  overrides?: Partial<SceneDefinition>,
): SceneDefinition {
  return {
    id: overrides?.id ?? `scene_ref_${index}`,
    name: overrides?.name ?? `场景 ${index}`,
    description: overrides?.description ?? "",
    basePrompt: overrides?.basePrompt ?? "",
    imageModel: overrides?.imageModel ?? DEFAULT_CHARACTER_IMAGE_MODEL,
    referenceImageAssetRefs: overrides?.referenceImageAssetRefs ?? [],
    placeholderUrl: overrides?.placeholderUrl,
    canvasPosition: overrides?.canvasPosition ?? {
      x: -40,
      y: 80 + Math.max(index - 1, 0) * 250,
    },
  };
}

export function buildTransitionEdge({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  conditionVariable,
  choiceLabel,
  animated,
}: {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  conditionVariable: string;
  choiceLabel?: string;
  animated?: boolean;
}): EditorFlowEdge {
  return {
    id: id ?? crypto.randomUUID(),
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep",
    animated: animated ?? false,
    data: {
      conditionVariable,
      choiceLabel,
    },
    label: createConditionLabel(conditionVariable, choiceLabel),
    labelStyle: {
      fontSize: 12,
      fontWeight: 600,
      fill: "#5a4330",
    },
    labelShowBg: true,
    labelBgPadding: [8, 5],
    labelBgBorderRadius: 999,
    labelBgStyle: {
      fill: "rgba(255, 248, 238, 0.95)",
      stroke: "rgba(122, 88, 56, 0.18)",
      strokeWidth: 1,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
  };
}

function canReachTarget(
  edges: Array<Pick<EditorFlowEdge, "source" | "target">>,
  currentNodeId: string,
  targetNodeId: string,
  visited = new Set<string>(),
): boolean {
  if (currentNodeId === targetNodeId) {
    return true;
  }

  if (visited.has(currentNodeId)) {
    return false;
  }

  visited.add(currentNodeId);

  for (const edge of edges) {
    if (
      edge.source === currentNodeId &&
      canReachTarget(edges, edge.target, targetNodeId, visited)
    ) {
      return true;
    }
  }

  return false;
}

export function validateTreeConnection(
  edges: Array<Pick<EditorFlowEdge, "id" | "source" | "target">>,
  source: string,
  target: string,
  ignoreEdgeId?: string,
) {
  const activeEdges = edges.filter((edge) => edge.id !== ignoreEdgeId);

  if (source === target) {
    return {
      valid: false,
      reason: "节点不能连回自己。",
    };
  }

  if (activeEdges.some((edge) => edge.source === source && edge.target === target)) {
    return {
      valid: false,
      reason: "同一条过渡已经存在。",
    };
  }

  if (activeEdges.some((edge) => edge.target === target)) {
    return {
      valid: false,
      reason: "每个子节点只能有一个父节点。",
    };
  }

  if (canReachTarget(activeEdges, target, source)) {
    return {
      valid: false,
      reason: "当前剧情图不能形成环。",
    };
  }

  return {
    valid: true,
  };
}

export function createVideoSceneNode(
  position: XYPosition,
  overrides?: Partial<SerializedEditorNode["data"]>,
): EditorFlowNode {
  const isPendingGeneratedResult =
    overrides?.generationTask?.status === "succeeded" &&
    !overrides.generatedVideoUrl;

  return {
    id: crypto.randomUUID(),
    type: VIDEO_SCENE_NODE_TYPE,
    position,
    data: {
      title: overrides?.title ?? "新的视频片段",
      shotNotes: overrides?.shotNotes ?? "",
      actions: overrides?.actions ?? [],
      assetRef: overrides?.assetRef,
      generatedVideoUrl: overrides?.generatedVideoUrl,
      generatedCoverUrl: overrides?.generatedCoverUrl,
      assetError: undefined,
      assetStatus: isPendingGeneratedResult
        ? "generating"
        : overrides?.assetRef
        ? "missing"
        : overrides?.generatedVideoUrl
          ? "generated"
          : "empty",
      trim: overrides?.trim ?? { startMs: 0 },
      generation: overrides?.generation ?? { ...DEFAULT_GENERATION_CONFIG },
      generationTask: overrides?.generationTask,
    },
  };
}

export function serializeProject(
  nodes: EditorFlowNode[],
  edges: EditorFlowEdge[],
  characters: CharacterDefinition[],
  scenes: SceneDefinition[],
  settings: ProjectSettings,
): EditorProject {
  return {
    version: PROJECT_VERSION,
    characters,
    scenes,
    settings,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: VIDEO_SCENE_NODE_TYPE,
      position: node.position,
      data: {
        title: node.data.title,
        shotNotes: node.data.shotNotes,
        actions: node.data.actions,
        assetRef: node.data.assetRef,
        generatedVideoUrl: node.data.generatedVideoUrl,
        generatedCoverUrl: node.data.generatedCoverUrl,
        trim: node.data.trim,
        generation: node.data.generation,
        generationTask: node.data.generationTask,
      },
    })),
    edges: edges.map((edge, index) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: edge.type,
      animated: edge.animated,
      conditionVariable:
        sanitizeConditionVariable(edge.data?.conditionVariable) ??
        createConditionVariable(index + 1),
      choiceLabel:
        typeof edge.data?.choiceLabel === "string" &&
        edge.data.choiceLabel.trim().length > 0
          ? edge.data.choiceLabel.trim()
          : undefined,
    })),
  };
}

export function parseProject(value: unknown): EditorProject {
  if (!isRecord(value)) {
    throw new Error("工程 JSON 顶层结构无效。");
  }

  const version =
    typeof value.version === "number" && Number.isFinite(value.version)
      ? value.version
      : undefined;

  if (version !== 1 && version !== 2 && version !== PROJECT_VERSION) {
    throw new Error(
      `工程版本不匹配。当前支持版本 1、2 和 ${PROJECT_VERSION}。`,
    );
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("工程必须包含 nodes 和 edges 数组。");
  }

  if (version === 1) {
    return {
      version: PROJECT_VERSION,
      nodes: value.nodes.map((node) => migrateVersionOneNode(node)),
      edges: value.edges.map((edge) => sanitizeSerializedEdge(edge)),
      characters: [],
      scenes: [],
      settings: {
        providerPriority: [...DEFAULT_PROVIDER_PRIORITY],
      },
    };
  }

  return {
    version: PROJECT_VERSION,
    nodes: value.nodes.map((node) => sanitizeSerializedNode(node)),
    edges: value.edges.map((edge) => sanitizeSerializedEdge(edge)),
    characters: Array.isArray(value.characters)
      ? value.characters.map((character, index) =>
          sanitizeCharacter(character, index + 1),
        )
      : [],
    scenes: Array.isArray(value.scenes)
      ? value.scenes.map((scene, index) =>
          sanitizeSceneDefinition(scene, index + 1),
        )
      : [],
    settings: sanitizeProjectSettings(value.settings),
  };
}

export function hydrateProjectNodes(project: EditorProject): EditorFlowNode[] {
  return project.nodes.map((node) => ({
    id: node.id,
    type: VIDEO_SCENE_NODE_TYPE,
    position: node.position,
    data: {
      title: node.data.title,
      shotNotes: node.data.shotNotes,
      actions: node.data.actions,
      assetRef: node.data.assetRef,
      generatedVideoUrl: node.data.generatedVideoUrl,
      generatedCoverUrl: node.data.generatedCoverUrl,
      assetError: undefined,
      assetStatus: node.data.generationTask
        ? node.data.generationTask.status === "failed"
          ? "failed"
          : node.data.generationTask.status === "succeeded" &&
              !node.data.generatedVideoUrl
            ? "generating"
          : node.data.generationTask.status === "queued" ||
              node.data.generationTask.status === "processing"
            ? "generating"
            : node.data.generatedVideoUrl
              ? "generated"
              : node.data.assetRef
                ? "missing"
                : "empty"
        : node.data.generatedVideoUrl
          ? "generated"
          : node.data.assetRef
            ? "missing"
            : "empty",
      trim: node.data.trim,
      generation: node.data.generation,
      generationTask: node.data.generationTask,
    },
  }));
}

export function hydrateProjectEdges(project: EditorProject) {
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  const edges: EditorFlowEdge[] = [];
  let skippedCount = 0;
  let normalizedConditionCount = 0;

  for (let index = 0; index < project.edges.length; index += 1) {
    const edge = project.edges[index];

    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      skippedCount += 1;
      continue;
    }

    const validation = validateTreeConnection(edges, edge.source, edge.target);

    if (!validation.valid) {
      skippedCount += 1;
      continue;
    }

    const conditionVariable =
      sanitizeConditionVariable(edge.conditionVariable) ??
      createConditionVariable(index + 1);

    if (!sanitizeConditionVariable(edge.conditionVariable)) {
      normalizedConditionCount += 1;
    }

    edges.push(
      buildTransitionEdge({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        conditionVariable,
        choiceLabel: edge.choiceLabel,
        animated: edge.animated ?? false,
      }),
    );
  }

  return {
    edges,
    skippedCount,
    normalizedConditionCount,
  };
}
