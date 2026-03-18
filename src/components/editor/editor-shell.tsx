"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Image from "next/image";
import {
  DEFAULT_PROVIDER_CREDENTIALS,
  DEFAULT_PROVIDER_PRIORITY,
  PROVIDER_DEFINITIONS,
  getConfiguredProviderPriority,
  getProviderDefaultModel,
  isCredentialConfigured,
  type GenerationProviderSelection,
  type ProviderCredentialState,
  type UnifiedVideoCreateResponse,
  type UnifiedVideoGenerationRequest,
  type VideoProviderId,
} from "../../lib/video-generation";
import {
  IMAGE_MODEL_OPTIONS,
  buildCharacterImagePrompt,
  buildSceneImagePrompt,
  type ImageGenerationModel,
} from "../../lib/image-generation";
import {
  applyAgentDraftToEditorGraph,
  createRandomStoryTemplate,
  type AgentScreenplay,
  type AgentDraft,
} from "../../lib/agent-mode";
import {
  buildInteractiveExportBundle,
  buildTraversalExportBundles,
} from "../../lib/export-packages";
import {
  applyDemoVisuals,
  DEMO_AGENT_DRAFT,
  DEMO_AGENT_SCREENPLAY,
  DEMO_STORY_TEXT,
} from "../../lib/demo-case";
import { useResizer } from "./use-resizer";
import styles from "./editor-shell.module.css";
import {
  CharacterReferenceNode,
  type CharacterReferenceNodeData,
} from "./character-reference-node";
import {
  SceneReferenceNode,
  type SceneReferenceNodeData,
} from "./scene-reference-node";
import {
  buildTransitionEdge,
  CHARACTER_REFERENCE_NODE_TYPE,
  SCENE_REFERENCE_NODE_TYPE,
  createCharacterDefinition,
  createSceneDefinition,
  createConditionLabel,
  createConditionVariable,
  createSceneAction,
  createVideoSceneNode,
  hydrateProjectEdges,
  hydrateProjectNodes,
  parseProject,
  PROJECT_VERSION,
  serializeProject,
  validateTreeConnection,
  type AssetKind,
  type AssetRef,
  type CharacterDefinition,
  type EditorFlowEdge,
  type EditorFlowNode,
  type ProjectSettings,
  type SceneDefinition,
  type SceneAction,
  type TrimRange,
} from "./project";
import { TrimPreview } from "./trim-preview";
import { VideoSceneNode } from "./video-scene-node";

type RuntimeAsset = {
  file: File;
  objectUrl: string;
  kind: AssetKind;
};

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};

type CharacterCanvasNode = Node<
  CharacterReferenceNodeData,
  typeof CHARACTER_REFERENCE_NODE_TYPE
>;

type SceneCanvasNode = Node<
  SceneReferenceNodeData,
  typeof SCENE_REFERENCE_NODE_TYPE
>;

type CanvasFlowNode = EditorFlowNode | CharacterCanvasNode | SceneCanvasNode;

const nodeTypes = {
  videoScene: VideoSceneNode,
  characterReference: CharacterReferenceNode,
  sceneReference: SceneReferenceNode,
};

const PROVIDER_STORAGE_KEY = "int-video-game-editor.provider-credentials.v1";
const AGENT_API_KEY_STORAGE_KEY = "int-video-game-editor.agent-api-key.v1";
const DEFAULT_LOCAL_PROVIDER_CREDENTIALS: ProviderCredentialState = {
  ...DEFAULT_PROVIDER_CREDENTIALS,
  doubao: {
    apiKey: process.env.NEXT_PUBLIC_VOLCENGINE_API_KEY ?? "",
  },
};

function normalizeProviderPriority(priority?: unknown): VideoProviderId[] {
  const nextPriority: VideoProviderId[] = [];

  if (Array.isArray(priority)) {
    for (const item of priority) {
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

  for (const providerId of DEFAULT_PROVIDER_PRIORITY) {
    if (!nextPriority.includes(providerId)) {
      nextPriority.push(providerId);
    }
  }

  return nextPriority;
}
const CHARACTER_NODE_ID_PREFIX = "character-card:";
const SCENE_NODE_ID_PREFIX = "scene-card:";
const REFERENCE_PLACEHOLDER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg width="720" height="720" viewBox="0 0 720 720" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="720" height="720" rx="48" fill="#F2E6D7"/>
  <rect x="56" y="56" width="608" height="608" rx="36" fill="#FFF8F0" stroke="#D8C4AD" stroke-width="3"/>
  <circle cx="360" cy="264" r="110" fill="#D6B99B"/>
  <path d="M176 594C204 477 272 418 360 418C448 418 516 477 544 594" fill="#D6B99B"/>
  <rect x="108" y="110" width="164" height="38" rx="19" fill="#E7D7C5"/>
  <rect x="108" y="160" width="264" height="26" rx="13" fill="#EFE3D5"/>
  <rect x="108" y="196" width="220" height="26" rx="13" fill="#EFE3D5"/>
  <rect x="456" y="114" width="152" height="152" rx="24" fill="#F4ECE1" stroke="#D8C4AD" stroke-width="3" stroke-dasharray="10 12"/>
  <path d="M509 188L543 154L579 190" stroke="#C96A43" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M543 154V226" stroke="#C96A43" stroke-width="16" stroke-linecap="round"/>
  <rect x="458" y="314" width="148" height="40" rx="20" fill="#D96C44"/>
  <text x="532" y="340" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#FFF8F0">参考图</text>
  <text x="360" y="642" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#7E6853">上传角色参考图</text>
</svg>
`)}`;
const SCENE_PLACEHOLDER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg width="960" height="600" viewBox="0 0 960 600" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="600" rx="40" fill="#10202B"/>
  <rect x="40" y="40" width="880" height="520" rx="28" fill="#173142" stroke="#4E86A4" stroke-width="3"/>
  <rect x="88" y="96" width="280" height="30" rx="15" fill="#2A526A"/>
  <rect x="88" y="142" width="360" height="22" rx="11" fill="#21465B"/>
  <circle cx="760" cy="130" r="48" fill="#F7C77D"/>
  <path d="M120 430C210 328 322 276 454 276C610 276 732 348 824 502H120V430Z" fill="#27495D"/>
  <rect x="544" y="320" width="176" height="110" rx="18" fill="#21455B" stroke="#74C4DD" stroke-width="3" stroke-dasharray="10 10"/>
  <path d="M596 373H668" stroke="#74C4DD" stroke-width="16" stroke-linecap="round"/>
  <path d="M632 338V408" stroke="#74C4DD" stroke-width="16" stroke-linecap="round"/>
  <text x="480" y="536" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#D9EEF6">上传场景参考图</text>
</svg>
`)}`;

function getVideoErrorMessage(error: MediaError | null) {
  if (!error) {
    return "浏览器没有成功加载这个视频文件。";
  }

  if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "当前浏览器不支持这个视频的编码格式，建议换成 H.264 MP4 或 WebM。";
  }

  if (error.code === MediaError.MEDIA_ERR_DECODE) {
    return "视频文件已读取，但浏览器解码失败。";
  }

  if (error.code === MediaError.MEDIA_ERR_NETWORK) {
    return "浏览器读取这个本地视频时发生了异常。";
  }

  if (error.code === MediaError.MEDIA_ERR_ABORTED) {
    return "视频加载被中断。";
  }

  return "视频加载失败。";
}

function probeVideoPreview(objectUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      callback();
    };

    const timeoutId = window.setTimeout(() => {
      finalize(() => {
        reject(new Error("视频预加载超时，浏览器没有成功解码这个文件。"));
      });
    }, 6000);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      finalize(() => {
        resolve();
      });
    };
    video.onerror = () => {
      const message = getVideoErrorMessage(video.error);

      finalize(() => {
        reject(new Error(message));
      });
    };
    video.src = objectUrl;
    video.load();
  });
}

function formatNodePosition(node: EditorFlowNode) {
  return `${Math.round(node.position.x)}, ${Math.round(node.position.y)}`;
}

function formatStatusLabel(node: EditorFlowNode) {
  if (node.data.assetStatus === "ready") {
    return "当前会话已绑定本地视频，可直接预览。";
  }

  if (node.data.assetStatus === "generated") {
    return "当前节点已经有生成结果，预览优先显示生成视频。";
  }

  if (node.data.assetStatus === "generating") {
    if (node.data.generationTask?.rawStatus === "succeeded") {
      return "任务已完成，正在同步最终的视频预览地址。";
    }

    return "生成任务已提交，编辑器会自动轮询最新状态。";
  }

  if (node.data.assetStatus === "failed") {
    return (
      node.data.generationTask?.errorMessage ??
      "生成任务失败，请检查 API 凭证、模型配额或提示词。"
    );
  }

  if (node.data.assetStatus === "missing") {
    return "工程已恢复素材引用，但需要重新选择本地视频文件。";
  }

  if (node.data.assetStatus === "unsupported") {
    return (
      node.data.assetError ??
      "当前浏览器无法解码这个视频文件，建议换成 H.264 MP4 或 WebM。"
    );
  }

  return "节点还没有本地视频，也没有生成结果。";
}

function getCharacterNodeId(characterId: string) {
  return `${CHARACTER_NODE_ID_PREFIX}${characterId}`;
}

function parseCharacterIdFromNodeId(nodeId: string) {
  if (!nodeId.startsWith(CHARACTER_NODE_ID_PREFIX)) {
    return null;
  }

  return nodeId.slice(CHARACTER_NODE_ID_PREFIX.length);
}

function getSceneNodeId(sceneId: string) {
  return `${SCENE_NODE_ID_PREFIX}${sceneId}`;
}

function parseSceneIdFromNodeId(nodeId: string) {
  if (!nodeId.startsWith(SCENE_NODE_ID_PREFIX)) {
    return null;
  }

  return nodeId.slice(SCENE_NODE_ID_PREFIX.length);
}

function slugifyCharacterId(value: string) {
  const nextValue = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return nextValue || "character";
}

function buildUniqueCharacterId(
  candidate: string,
  characters: CharacterDefinition[],
  currentId?: string,
) {
  const normalized = slugifyCharacterId(candidate);
  const existingIds = new Set(
    characters
      .map((character) => character.id)
      .filter((characterId) => characterId !== currentId),
  );

  if (!existingIds.has(normalized)) {
    return normalized;
  }

  let index = 2;

  while (existingIds.has(`${normalized}_${index}`)) {
    index += 1;
  }

  return `${normalized}_${index}`;
}

function slugifySceneId(value: string) {
  const nextValue = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return nextValue || "scene";
}

function buildUniqueSceneId(
  candidate: string,
  scenes: SceneDefinition[],
  currentId?: string,
) {
  const normalized = slugifySceneId(candidate);
  const existingIds = new Set(
    scenes
      .map((scene) => scene.id)
      .filter((sceneId) => sceneId !== currentId),
  );

  if (!existingIds.has(normalized)) {
    return normalized;
  }

  let index = 2;

  while (existingIds.has(`${normalized}_${index}`)) {
    index += 1;
  }

  return `${normalized}_${index}`;
}

function buildCharacterCanvasNode(
  character: CharacterDefinition,
  previewUrl: string,
  isActive: boolean,
): CharacterCanvasNode {
  return {
    id: getCharacterNodeId(character.id),
    type: CHARACTER_REFERENCE_NODE_TYPE,
    position: character.canvasPosition,
    data: {
      characterId: character.id,
      name: character.name,
      bio: character.bio,
      referenceCount: character.referenceImageAssetRefs.length,
      previewUrl,
      isActive,
    },
    draggable: true,
    selectable: true,
    deletable: false,
    connectable: false,
  };
}

function buildSceneCanvasNode(
  scene: SceneDefinition,
  previewUrl: string,
  isActive: boolean,
): SceneCanvasNode {
  return {
    id: getSceneNodeId(scene.id),
    type: SCENE_REFERENCE_NODE_TYPE,
    position: scene.canvasPosition,
    data: {
      sceneId: scene.id,
      name: scene.name,
      description: scene.description,
      referenceCount: scene.referenceImageAssetRefs.length,
      previewUrl,
      isActive,
    },
    draggable: true,
    selectable: true,
    deletable: false,
    connectable: false,
  };
}

function buildNodePrompt(
  node: EditorFlowNode,
  characters: CharacterDefinition[],
  scenes: SceneDefinition[],
) {
  const characterMap = new Map(characters.map((character) => [character.id, character]));
  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const lines = [
    `镜头标题：${node.data.title}`,
    `镜头时长：${node.data.generation.durationSec} 秒`,
    `画面比例：${node.data.generation.aspectRatio}`,
  ];

  if (node.data.actions.length > 0) {
    lines.push("角色表演：");

    for (const action of node.data.actions) {
      const character = characterMap.get(action.characterId);
      const actorLabel = character
        ? `${character.name}(@${character.id})`
        : action.characterId
          ? `@${action.characterId}`
          : "未指定角色";
      const segments = [actorLabel];

      if (action.action.trim().length > 0) {
        segments.push(action.action.trim());
      }

      if (action.emotion.trim().length > 0) {
        segments.push(`情绪：${action.emotion.trim()}`);
      }

      if (action.dialogue.trim().length > 0) {
        segments.push(`台词：${action.dialogue.trim()}`);
      }

      lines.push(`- ${segments.join("，")}`);
    }
  }

  const referencedScenes = node.data.generation.referenceSceneIds
    .map((sceneId) => sceneMap.get(sceneId))
    .filter((scene): scene is SceneDefinition => Boolean(scene));

  if (referencedScenes.length > 0) {
    lines.push("场景设定：");

    for (const scene of referencedScenes) {
      const segments = [`${scene.name}(#${scene.id})`];

      if (scene.description.trim().length > 0) {
        segments.push(scene.description.trim());
      }

      if (scene.basePrompt.trim().length > 0) {
        segments.push(`生成偏好：${scene.basePrompt.trim()}`);
      }

      lines.push(`- ${segments.join("，")}`);
    }
  }

  const referencedCharacters = Array.from(
    new Set(
      [
        ...node.data.generation.referenceCharacterIds,
        ...node.data.actions
          .map((action) => action.characterId)
          .filter((characterId) => characterId.trim().length > 0),
      ].filter(Boolean),
    ),
  )
    .map((characterId) => characterMap.get(characterId))
    .filter((character): character is CharacterDefinition => Boolean(character));

  if (referencedCharacters.length > 0) {
    lines.push("角色设定：");

    for (const character of referencedCharacters) {
      const segments = [`${character.name}(@${character.id})`];

      if (character.bio.trim().length > 0) {
        segments.push(character.bio.trim());
      }

      if (character.basePrompt.trim().length > 0) {
        segments.push(`生成偏好：${character.basePrompt.trim()}`);
      }

      lines.push(`- ${segments.join("，")}`);
    }
  }

  if (node.data.shotNotes.trim().length > 0) {
    lines.push(`镜头备注：${node.data.shotNotes.trim()}`);
  }

  lines.push("请输出电影感、角色一致性强、适合互动短剧节点的视频片段。");

  if (node.data.generation.promptOverride.trim().length > 0) {
    lines.push(`补充要求：${node.data.generation.promptOverride.trim()}`);
  }

  return lines.join("\n");
}

function getNodePreviewUrl(
  node: EditorFlowNode,
  assetRuntimeMap: Record<string, RuntimeAsset>,
) {
  if (node.data.generatedVideoUrl) {
    return node.data.generatedVideoUrl;
  }

  if (node.data.assetRef) {
    return assetRuntimeMap[node.data.assetRef.assetId]?.objectUrl;
  }

  return undefined;
}

function getCharacterPreviewUrl(
  character: CharacterDefinition,
  assetRuntimeMap: Record<string, RuntimeAsset>,
) {
  return (
    assetRuntimeMap[character.referenceImageAssetRefs[0]?.assetId ?? ""]?.objectUrl ??
    character.placeholderUrl ??
    REFERENCE_PLACEHOLDER_SVG
  );
}

function getScenePreviewUrl(
  scene: SceneDefinition,
  assetRuntimeMap: Record<string, RuntimeAsset>,
) {
  return (
    assetRuntimeMap[scene.referenceImageAssetRefs[0]?.assetId ?? ""]?.objectUrl ??
    scene.placeholderUrl ??
    SCENE_PLACEHOLDER_SVG
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("文件读取失败。"));
    };

    reader.onerror = () => {
      reject(new Error("文件读取失败。"));
    };

    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl: string, fileName: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return new File([blob], fileName, {
    type: blob.type || "image/png",
  });
}

function downloadBlobFile(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export function EditorShell() {
  const [nodes, setNodes] = useState<EditorFlowNode[]>(() => [
    createVideoSceneNode(
      { x: 80, y: 120 },
      {
        title: "开场镜头",
      },
    ),
  ]);
  const [edges, setEdges] = useState<EditorFlowEdge[]>([]);
  const [characters, setCharacters] = useState<CharacterDefinition[]>([]);
  const [scenes, setScenes] = useState<SceneDefinition[]>([]);
  const [settings, setSettings] = useState<ProjectSettings>({
    providerPriority: normalizeProviderPriority(DEFAULT_PROVIDER_PRIORITY),
  });
  const [providerCredentials, setProviderCredentials] =
    useState<ProviderCredentialState>(DEFAULT_LOCAL_PROVIDER_CREDENTIALS);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [isAgentModeOpen, setIsAgentModeOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [characterCanvasNodes, setCharacterCanvasNodes] = useState<
    CharacterCanvasNode[]
  >([]);
  const [sceneCanvasNodes, setSceneCanvasNodes] = useState<SceneCanvasNode[]>([]);
  const [assetRuntimeMap, setAssetRuntimeMap] = useState<
    Record<string, RuntimeAsset>
  >({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [generatingCharacterIds, setGeneratingCharacterIds] = useState<string[]>(
    [],
  );
  const [agentStoryText, setAgentStoryText] = useState("");
  const [agentFeedbackText, setAgentFeedbackText] = useState("");
  const [agentImageUrl, setAgentImageUrl] = useState("");
  const [agentApiKey, setAgentApiKey] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(AGENT_API_KEY_STORAGE_KEY) ?? "";
    }
    return "";
  });
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentScreenplay, setAgentScreenplay] = useState<AgentScreenplay | null>(null);
  const [isGeneratingAgentDraft, setIsGeneratingAgentDraft] = useState(false);
  const [isGeneratingAgentScreenplay, setIsGeneratingAgentScreenplay] = useState(false);
  const [isGeneratingRandomAgentStory, setIsGeneratingRandomAgentStory] =
    useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    flowPosition: { x: number; y: number };
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const assetRuntimeMapRef = useRef<Record<string, RuntimeAsset>>({});
  const generatingCharacterIdsRef = useRef(new Set<string>());
  const nodesRef = useRef<EditorFlowNode[]>([]);
  const providerCredentialsRef = useRef<ProviderCredentialState>(
    DEFAULT_LOCAL_PROVIDER_CREDENTIALS,
  );
  const pollingVideoTaskIdsRef = useRef(new Set<string>());
  const reactFlowRef =
    useRef<ReactFlowInstance<CanvasFlowNode, EditorFlowEdge> | null>(null);

  const sidebarResizer = useResizer(360, 240, 600, 'right');
  const detailsResizer = useResizer(360, 240, 600, 'left');

  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedCharacter =
    characters.find((character) => character.id === selectedCharacterId) ?? null;
  const selectedScene =
    scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const selectedEdge =
    edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const nodeTitleMap = useMemo(
    () =>
      Object.fromEntries(nodes.map((node) => [node.id, node.data.title])),
    [nodes],
  );

  const characterNameMap = useMemo(
    () =>
      Object.fromEntries(
        characters.map((character) => [character.id, character.name]),
      ),
    [characters],
  );

  const selectedNodePrompt = selectedNode
    ? buildNodePrompt(selectedNode, characters, scenes)
    : "";
  const generatingCharacterIdSet = useMemo(
    () => new Set(generatingCharacterIds),
    [generatingCharacterIds],
  );
  const agentSceneGroups = useMemo(() => {
    if (!agentDraft) {
      return [];
    }

    const groups = agentDraft.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      tone: branch.tone,
      predictedOutcome: branch.predictedOutcome,
      scenes: agentDraft.scenes.filter((scene) => scene.branchId === branch.id),
    }));
    const orphanScenes = agentDraft.scenes.filter(
      (scene) => !agentDraft.branches.some((branch) => branch.id === scene.branchId),
    );

    if (orphanScenes.length > 0) {
      groups.push({
        id: "ungrouped",
        name: "未归类",
        tone: "草案",
        predictedOutcome: "这些镜头暂时还没有落到明确分支里。",
        scenes: orphanScenes,
      });
    }

    return groups.filter((group) => group.scenes.length > 0);
  }, [agentDraft]);
  const agentRootSceneCount = useMemo(() => {
    if (!agentDraft) {
      return 0;
    }

    const targetSceneIds = new Set(
      agentDraft.transitions.map((transition) => transition.targetSceneId),
    );

    return agentDraft.scenes.filter((scene) => !targetSceneIds.has(scene.id)).length;
  }, [agentDraft]);
  const hasPollablePendingVideoTask = useMemo(
    () =>
      nodes.some(
        (node) =>
          (node.data.generationTask?.status === "queued" ||
            node.data.generationTask?.status === "processing" ||
            (node.data.generationTask?.status === "succeeded" &&
              (!node.data.generatedVideoUrl ||
                node.data.generatedVideoUrl.trim().length === 0))) &&
          Boolean(
            node.data.generationTask?.taskId &&
              node.data.generationTask.taskId !== "pending",
          ),
      ),
    [nodes],
  );

  function updateNode(
    nodeId: string,
    updater: (node: EditorFlowNode) => EditorFlowNode,
  ) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => (node.id === nodeId ? updater(node) : node)),
    );
  }

  function revokeAssetsById(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    setAssetRuntimeMap((currentMap) => {
      const nextMap = { ...currentMap };

      for (const assetId of assetIds) {
        const runtimeAsset = nextMap[assetId];

        if (!runtimeAsset) {
          continue;
        }

        URL.revokeObjectURL(runtimeAsset.objectUrl);
        delete nextMap[assetId];
      }

      return nextMap;
    });
  }

  async function replaceNodeAsset(nodeId: string, file: File) {
    if (!file.type.startsWith("video/")) {
      setNotice({
        tone: "error",
        message: "请选择一个可播放的视频文件。",
      });
      return;
    }

    const currentNode = nodes.find((node) => node.id === nodeId);

    if (!currentNode) {
      return;
    }

    const nextAssetId = crypto.randomUUID();
    const nextObjectUrl = URL.createObjectURL(file);
    const previousAssetId = currentNode.data.assetRef?.assetId;
    const nextAssetRef: AssetRef = {
      assetId: nextAssetId,
      fileName: file.name,
      mimeType: file.type || undefined,
      kind: "video",
    };

    try {
      await probeVideoPreview(nextObjectUrl);
    } catch (error) {
      URL.revokeObjectURL(nextObjectUrl);

      updateNode(nodeId, (node) => ({
        ...node,
        data: {
          ...node.data,
          assetRef: nextAssetRef,
          assetError:
            error instanceof Error
              ? error.message
              : "当前视频无法在浏览器中预览。",
          assetStatus: "unsupported",
        },
      }));

      setNotice({
        tone: "error",
        message: `「${file.name}」无法预览：${
          error instanceof Error
            ? error.message
            : "当前浏览器无法解码这个视频文件。"
        }`,
      });

      if (previousAssetId) {
        revokeAssetsById([previousAssetId]);
      }

      return;
    }

    setAssetRuntimeMap((currentMap) => {
      const nextMap = { ...currentMap };

      if (previousAssetId && nextMap[previousAssetId]) {
        URL.revokeObjectURL(nextMap[previousAssetId].objectUrl);
        delete nextMap[previousAssetId];
      }

      nextMap[nextAssetId] = {
        file,
        objectUrl: nextObjectUrl,
        kind: "video",
      };

      return nextMap;
    });

    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        assetRef: nextAssetRef,
        assetError: undefined,
        assetStatus: node.data.generatedVideoUrl ? "generated" : "ready",
      },
    }));

    setNotice({
      tone: "success",
      message: `已为「${currentNode.data.title}」绑定视频 ${file.name}。`,
    });
  }

  function clearNodeAsset(nodeId: string) {
    const currentNode = nodes.find((node) => node.id === nodeId);
    const assetId = currentNode?.data.assetRef?.assetId;

    if (!currentNode) {
      return;
    }

    if (assetId) {
      revokeAssetsById([assetId]);
    }

    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        assetRef: undefined,
        assetError: undefined,
        assetStatus: node.data.generatedVideoUrl ? "generated" : "empty",
      },
    }));

    setNotice({
      tone: "success",
      message: `已清空「${currentNode.data.title}」的本地视频绑定。`,
    });
  }

  function clearGeneratedVideo(nodeId: string) {
    const currentNode = nodes.find((node) => node.id === nodeId);

    if (!currentNode) {
      return;
    }

    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        generatedVideoUrl: undefined,
        generatedCoverUrl: undefined,
        generationTask: undefined,
        assetStatus: node.data.assetRef ? "ready" : "empty",
      },
    }));

    setNotice({
      tone: "success",
      message: `已清空「${currentNode.data.title}」的生成结果。`,
    });
  }

  function cleanupAllAssets() {
    setAssetRuntimeMap((currentMap) => {
      for (const runtimeAsset of Object.values(currentMap)) {
        URL.revokeObjectURL(runtimeAsset.objectUrl);
      }

      return {};
    });
  }

  function appendCharacterReferenceFiles(characterId: string, files: File[]) {
    if (files.length === 0) {
      return;
    }

    const runtimeEntries = files.map((file) => {
      const assetId = crypto.randomUUID();

      return {
        assetRef: {
          assetId,
          fileName: file.name,
          mimeType: file.type || undefined,
          kind: "image" as const,
        },
        runtimeAsset: {
          file,
          objectUrl: URL.createObjectURL(file),
          kind: "image" as const,
        },
      };
    });

    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              referenceImageAssetRefs: [
                ...runtimeEntries.map((entry) => entry.assetRef),
                ...character.referenceImageAssetRefs,
              ],
            }
          : character,
      ),
    );

    setAssetRuntimeMap((currentMap) => {
      const nextMap = { ...currentMap };

      for (const entry of runtimeEntries) {
        nextMap[entry.assetRef.assetId] = entry.runtimeAsset;
      }

      return nextMap;
    });
  }

  async function handleCharacterImageChange(
    characterId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const invalidFile = files.find((file) => !file.type.startsWith("image/"));

    if (invalidFile) {
      setNotice({
        tone: "error",
        message: `「${invalidFile.name}」不是图片文件。`,
      });
      return;
    }

    appendCharacterReferenceFiles(characterId, files);

    setNotice({
      tone: "success",
      message: `已为角色补充 ${files.length} 张参考图。`,
    });
  }

  async function handleGenerateCharacterImage(character: CharacterDefinition) {
    if (!providerCredentials.doubao.apiKey.trim()) {
      setNotice({
        tone: "error",
        message: "请先配置火山 API Key。",
      });
      return;
    }

    if (generatingCharacterIdsRef.current.has(character.id)) {
      return;
    }

    const prompt = buildCharacterImagePrompt({
      name: character.name,
      bio: character.bio,
      basePrompt: character.basePrompt,
    });

    generatingCharacterIdsRef.current.add(character.id);
    setGeneratingCharacterIds((currentIds) =>
      currentIds.includes(character.id) ? currentIds : [...currentIds, character.id],
    );

    try {
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: providerCredentials.doubao.apiKey,
          prompt,
          model: character.imageModel,
        }),
      });

      const result = (await response.json()) as {
        b64Json?: string;
        mimeType?: string;
        message?: string;
      };

      if (!response.ok || !result.b64Json) {
        throw new Error(result.message ?? "角色生图失败。");
      }

      const file = await dataUrlToFile(
        `data:${result.mimeType ?? "image/png"};base64,${result.b64Json}`,
        `${character.id}-${Date.now()}.png`,
      );

      appendCharacterReferenceFiles(character.id, [file]);
      setNotice({
        tone: "success",
        message: `已为「${character.name}」生成参考图。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "角色生图失败。",
      });
    } finally {
      generatingCharacterIdsRef.current.delete(character.id);
      setGeneratingCharacterIds((currentIds) =>
        currentIds.filter((currentId) => currentId !== character.id),
      );
    }
  }

  function removeCharacterReferenceAsset(characterId: string, assetId: string) {
    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              referenceImageAssetRefs: character.referenceImageAssetRefs.filter(
                (assetRef) => assetRef.assetId !== assetId,
              ),
            }
          : character,
      ),
    );
    revokeAssetsById([assetId]);
  }

  function attachExistingImageToCharacter(characterId: string, assetId: string) {
    const runtimeAsset = assetRuntimeMap[assetId];

    if (!runtimeAsset || runtimeAsset.kind !== "image") {
      return;
    }

    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? character.referenceImageAssetRefs.some((assetRef) => assetRef.assetId === assetId)
            ? character
            : {
                ...character,
                referenceImageAssetRefs: [
                  {
                    assetId,
                    fileName: runtimeAsset.file.name,
                    mimeType: runtimeAsset.file.type || undefined,
                    kind: "image",
                  },
                  ...character.referenceImageAssetRefs,
                ],
              }
          : character,
      ),
    );
  }

  function attachExistingVideoToNode(nodeId: string, assetId: string) {
    const runtimeAsset = assetRuntimeMap[assetId];

    if (!runtimeAsset || runtimeAsset.kind !== "video") {
      return;
    }

    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        assetRef: {
          assetId,
          fileName: runtimeAsset.file.name,
          mimeType: runtimeAsset.file.type || undefined,
          kind: "video",
        },
        assetError: undefined,
        assetStatus: node.data.generatedVideoUrl ? "generated" : "ready",
      },
    }));
  }

  useEffect(() => {
    assetRuntimeMapRef.current = assetRuntimeMap;
  }, [assetRuntimeMap]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    providerCredentialsRef.current = providerCredentials;
  }, [providerCredentials]);

  useEffect(() => {
    setCharacterCanvasNodes(
      characters.map((character) => {
        return buildCharacterCanvasNode(
          character,
          getCharacterPreviewUrl(character, assetRuntimeMap),
          selectedCharacterId === character.id,
        );
      }),
    );
  }, [assetRuntimeMap, characters, selectedCharacterId]);

  useEffect(() => {
    setSceneCanvasNodes(
      scenes.map((scene) => {
        return buildSceneCanvasNode(
          scene,
          getScenePreviewUrl(scene, assetRuntimeMap),
          selectedSceneId === scene.id,
        );
      }),
    );
  }, [assetRuntimeMap, scenes, selectedSceneId]);

  useEffect(() => {
    return () => {
      for (const runtimeAsset of Object.values(assetRuntimeMapRef.current)) {
        URL.revokeObjectURL(runtimeAsset.objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    const rawValue = window.localStorage.getItem(PROVIDER_STORAGE_KEY);

    if (!rawValue) {
      return;
    }

    try {
      const parsed = JSON.parse(rawValue) as Partial<ProviderCredentialState>;

      setProviderCredentials({
        doubao: {
          apiKey:
            parsed.doubao?.apiKey ??
            DEFAULT_LOCAL_PROVIDER_CREDENTIALS.doubao.apiKey,
        },
        minimax: {
          apiKey: parsed.minimax?.apiKey ?? "",
        },
        vidu: {
          apiKey: parsed.vidu?.apiKey ?? "",
        },
        kling: {
          accessKey: parsed.kling?.accessKey ?? "",
          secretKey: parsed.kling?.secretKey ?? "",
        },
      });
    } catch {
      window.localStorage.removeItem(PROVIDER_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEY,
      JSON.stringify(providerCredentials),
    );
  }, [providerCredentials]);

  useEffect(() => {
    setSettings((currentSettings) => {
      const normalizedPriority = normalizeProviderPriority(
        currentSettings.providerPriority,
      );

      if (
        normalizedPriority.length === currentSettings.providerPriority.length &&
        normalizedPriority.every(
          (providerId, index) => providerId === currentSettings.providerPriority[index],
        )
      ) {
        return currentSettings;
      }

      return {
        ...currentSettings,
        providerPriority: normalizedPriority,
      };
    });
  }, []);

  useEffect(() => {
    if (!isExportModalOpen && !isProviderModalOpen && !isAssetLibraryOpen && !isAgentModeOpen) {
      document.body.style.overflow = "";
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportModalOpen(false);
        setIsProviderModalOpen(false);
        setIsAssetLibraryOpen(false);
        setIsAgentModeOpen(false);
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAgentModeOpen, isAssetLibraryOpen, isExportModalOpen, isProviderModalOpen]);

  useEffect(() => {
    if (!hasPollablePendingVideoTask) {
      return;
    }

    const pollPendingNodes = () => {
      const pendingNodes = nodesRef.current.filter(
        (node) =>
          (node.data.generationTask?.status === "queued" ||
            node.data.generationTask?.status === "processing" ||
            (node.data.generationTask?.status === "succeeded" &&
              (!node.data.generatedVideoUrl ||
                node.data.generatedVideoUrl.trim().length === 0))) &&
          Boolean(
            node.data.generationTask?.taskId &&
              node.data.generationTask.taskId !== "pending",
          ),
      );

      if (pendingNodes.length === 0) {
        return;
      }

      void Promise.all(
        pendingNodes.map(async (node) => {
          const generationTask = node.data.generationTask;

          if (!generationTask) {
            return;
          }

          const pollingKey = `${generationTask.providerId}:${generationTask.taskId}`;

          if (pollingVideoTaskIdsRef.current.has(pollingKey)) {
            return;
          }

          pollingVideoTaskIdsRef.current.add(pollingKey);

          try {
            const response = await fetch("/api/video/status", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                providerId: generationTask.providerId,
                taskId: generationTask.taskId,
                credentials: providerCredentialsRef.current,
              }),
            });
            const result = (await response.json()) as UnifiedVideoCreateResponse & {
              message?: string;
            };

            if (!response.ok) {
              throw new Error(result.message ?? "查询任务状态失败。");
            }

            const hasGeneratedVideo =
              result.status === "succeeded" &&
              typeof result.videoUrl === "string" &&
              result.videoUrl.trim().length > 0;

            updateNode(node.id, (currentNode) => ({
              ...currentNode,
              data: {
                ...currentNode.data,
                generatedVideoUrl:
                  hasGeneratedVideo
                    ? result.videoUrl ?? currentNode.data.generatedVideoUrl
                    : currentNode.data.generatedVideoUrl,
                generatedCoverUrl:
                  hasGeneratedVideo
                    ? result.coverUrl ?? currentNode.data.generatedCoverUrl
                    : currentNode.data.generatedCoverUrl,
                generationTask: currentNode.data.generationTask
                  ? {
                      ...currentNode.data.generationTask,
                      status:
                        result.status === "failed"
                          ? "failed"
                          : hasGeneratedVideo
                            ? "succeeded"
                            : "processing",
                      rawStatus: result.rawStatus,
                      errorMessage: result.errorMessage,
                    }
                  : undefined,
                assetStatus:
                  hasGeneratedVideo
                    ? "generated"
                    : result.status === "failed"
                      ? "failed"
                      : "generating",
              },
            }));
          } catch {
            updateNode(node.id, (currentNode) => {
              if (
                !currentNode.data.generationTask ||
                currentNode.data.generationTask.taskId !== generationTask.taskId
              ) {
                return currentNode;
              }

              return {
                ...currentNode,
                data: {
                  ...currentNode.data,
                  generationTask: {
                    ...currentNode.data.generationTask,
                    errorMessage:
                      currentNode.data.generationTask.status === "failed"
                        ? currentNode.data.generationTask.errorMessage
                        : undefined,
                  },
                },
              };
            });
          } finally {
            pollingVideoTaskIdsRef.current.delete(pollingKey);
          }
        }),
      );
    };

    pollPendingNodes();

    const intervalId = window.setInterval(() => {
      pollPendingNodes();
    }, 4500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasPollablePendingVideoTask]);

  function handleAddNode() {
    setNodes((currentNodes) => [
      ...currentNodes,
      createVideoSceneNode(
        {
          x: 90 + currentNodes.length * 26,
          y: 110 + currentNodes.length * 22,
        },
        { title: `片段 ${currentNodes.length + 1}` },
      ),
    ]);

    setNotice({
      tone: "success",
      message: "已新增一个视频节点。",
    });
    setSelectedSceneId(null);
  }

  function handleLoadDemoCase() {
    const nextGraph = applyAgentDraftToEditorGraph(DEMO_AGENT_DRAFT);
    const demoVisuals = applyDemoVisuals({
      characters: nextGraph.characters,
      scenes: nextGraph.scenes,
    });

    cleanupAllAssets();

    startTransition(() => {
      setNodes(nextGraph.nodes);
      setEdges(nextGraph.edges);
      setCharacters(demoVisuals.characters);
      setScenes(demoVisuals.scenes);
      setSelectedNodeId(null);
      setSelectedCharacterId(null);
      setSelectedSceneId(null);
      setSelectedEdgeId(null);
      setAgentStoryText(DEMO_STORY_TEXT);
      setAgentFeedbackText("");
      setAgentDraft(DEMO_AGENT_DRAFT);
      setAgentScreenplay(DEMO_AGENT_SCREENPLAY);
    });

    setNotice({
      tone: "success",
      message: "已加载高质量 Demo Case，可直接在角色卡和场景卡上继续上传参考图。",
    });

    requestAnimationFrame(() => {
      reactFlowRef.current?.fitView({
        duration: 220,
        padding: 0.24,
      });
    });
  }

  function handleNodesChange(changes: NodeChange<CanvasFlowNode>[]) {
    const sceneChanges: NodeChange<EditorFlowNode>[] = [];

    for (const change of changes) {
      if (change.type === "add") {
        sceneChanges.push(change as NodeChange<EditorFlowNode>);
        continue;
      }

      const characterId = parseCharacterIdFromNodeId(change.id);

      if (characterId) {
        continue;
      }

      const sceneId = parseSceneIdFromNodeId(change.id);

      if (sceneId) {
        continue;
      }

      if (!characterId) {
        sceneChanges.push(change as NodeChange<EditorFlowNode>);
      }
    }

    const removedIds = sceneChanges
      .filter((change) => change.type === "remove")
      .map((change) => change.id);

    if (removedIds.length > 0) {
      const assetIds = nodes
        .filter((node) => removedIds.includes(node.id))
        .map((node) => node.data.assetRef?.assetId)
        .filter((assetId): assetId is string => Boolean(assetId));

      revokeAssetsById(assetIds);

      if (selectedNodeId && removedIds.includes(selectedNodeId)) {
        setSelectedNodeId(null);
      }

      if (selectedEdgeId) {
        setSelectedEdgeId(null);
      }
    }

    if (sceneChanges.length > 0) {
      setNodes((currentNodes) => applyNodeChanges(sceneChanges, currentNodes));
    }
  }

  function handleCharacterNodeDragStop(nodeId: string, position: { x: number; y: number }) {
    const characterId = parseCharacterIdFromNodeId(nodeId);

    if (!characterId || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return;
    }

    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              canvasPosition: position,
            }
          : character,
      ),
    );
  }

  function handleSceneNodeDragStop(nodeId: string, position: { x: number; y: number }) {
    const sceneId = parseSceneIdFromNodeId(nodeId);

    if (!sceneId || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return;
    }

    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              canvasPosition: position,
            }
          : scene,
      ),
    );
  }

  function handleEdgesChange(changes: EdgeChange<EditorFlowEdge>[]) {
    const removedIds = changes
      .filter((change) => change.type === "remove")
      .map((change) => change.id);

    if (
      removedIds.length > 0 &&
      selectedEdgeId &&
      removedIds.includes(selectedEdgeId)
    ) {
      setSelectedEdgeId(null);
    }

    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
      return;
    }

    const validation = validateTreeConnection(
      edges,
      connection.source,
      connection.target,
    );

    if (!validation.valid) {
      setNotice({
        tone: "error",
        message: validation.reason ?? "当前连线不合法。",
      });
      return;
    }

    const nextEdge = buildTransitionEdge({
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      conditionVariable: createConditionVariable(edges.length + 1),
      choiceLabel: "继续",
    });

    setEdges((currentEdges) => [...currentEdges, nextEdge]);
    setSelectedNodeId(null);
    setSelectedCharacterId(null);
    setSelectedSceneId(null);
    setSelectedEdgeId(nextEdge.id);
    setNotice({
      tone: "success",
      message: "已创建过渡，并自动分配条件变量。",
    });
  }

  function handleConnectEnd(
    event: MouseEvent | TouchEvent,
    connectionState: { fromHandle?: { nodeId?: string; type?: string } | null; toNode?: { id?: string } | null; isValid?: boolean | null },
  ) {
    // If xyflow already found a valid target handle, it handled via onConnect — skip.
    if (connectionState.isValid) return;

    const fromNodeId = connectionState.fromHandle?.nodeId;
    let toNodeId = connectionState.toNode?.id;

    // If xyflow didn't find a toNode (dropped on card body, not handle),
    // manually find the node under the cursor.
    if (!toNodeId && reactFlowRef.current) {
      const clientPos = "changedTouches" in event
        ? { x: (event as TouchEvent).changedTouches[0].clientX, y: (event as TouchEvent).changedTouches[0].clientY }
        : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      const flowPos = reactFlowRef.current.screenToFlowPosition(clientPos);
      const nearbyNode = nodes.find((n) => {
        if (n.id === fromNodeId) return false;
        const w = n.measured?.width ?? n.width ?? 280;
        const h = n.measured?.height ?? n.height ?? 200;
        // Generous hit area — 40px padding around the node
        const pad = 40;
        return (
          flowPos.x >= n.position.x - pad &&
          flowPos.x <= n.position.x + w + pad &&
          flowPos.y >= n.position.y - pad &&
          flowPos.y <= n.position.y + h + pad
        );
      });
      if (nearbyNode) toNodeId = nearbyNode.id;
    }

    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;

    // Determine direction: if we dragged from a source handle (bottom), the
    // dropped-on node is the target. If we dragged from a target handle (top),
    // the dropped-on node becomes the source.
    const draggedFromSource = connectionState.fromHandle?.type === "source";
    const source = draggedFromSource ? fromNodeId : toNodeId;
    const target = draggedFromSource ? toNodeId : fromNodeId;

    handleConnect({
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
    });
  }

  function handleAddNodeAtPosition(position: { x: number; y: number }) {
    const newNode = createVideoSceneNode(position, {
      title: `片段 ${nodes.length + 1}`,
    });
    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(newNode.id);
    setSelectedCharacterId(null);
    setSelectedSceneId(null);
    setSelectedEdgeId(null);
    setNotice({ tone: "success", message: "已在画布位置新增视频节点。" });
  }

  function handleAddCharacterAtPosition(position: { x: number; y: number }) {
    const nextIndex = characters.length + 1;
    const newChar = createCharacterDefinition(nextIndex, {
      canvasPosition: position,
    });
    setCharacters((prev) => [...prev, newChar]);
    setSelectedCharacterId(newChar.id);
    setSelectedNodeId(null);
    setSelectedSceneId(null);
    setSelectedEdgeId(null);
    setNotice({ tone: "success", message: "已在画布位置新增角色卡。" });
  }

  function handleAddSceneAtPosition(position: { x: number; y: number }) {
    const nextIndex = scenes.length + 1;
    const newScene = createSceneDefinition(nextIndex, {
      canvasPosition: position,
    });
    setScenes((prev) => [...prev, newScene]);
    setSelectedSceneId(newScene.id);
    setSelectedNodeId(null);
    setSelectedCharacterId(null);
    setSelectedEdgeId(null);
    setNotice({ tone: "success", message: "已在画布位置新增场景卡。" });
  }

  function handlePaneContextMenu(event: MouseEvent | React.MouseEvent) {
    event.preventDefault();
    if (!reactFlowRef.current) return;
    const bounds = (event.target as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
    if (!bounds) return;
    const flowPosition = reactFlowRef.current.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    setContextMenu({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      flowPosition,
    });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        title,
      },
    }));
  }, []);

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const project = parseProject(JSON.parse(rawText));
      const nextNodes = hydrateProjectNodes(project);
      const hydratedEdges = hydrateProjectEdges(project);

      cleanupAllAssets();

      startTransition(() => {
        setNodes(nextNodes);
        setEdges(hydratedEdges.edges);
        setCharacters(project.characters);
        setScenes(project.scenes);
        setSettings(project.settings);
        setSelectedNodeId(null);
        setSelectedCharacterId(null);
        setSelectedSceneId(null);
        setSelectedEdgeId(null);
      });

      setNotice({
        tone: "success",
        message:
          hydratedEdges.skippedCount > 0 || hydratedEdges.normalizedConditionCount > 0
            ? `工程已导入。已跳过 ${hydratedEdges.skippedCount} 条不符合树结构的连线，补全 ${hydratedEdges.normalizedConditionCount} 个缺失的条件变量；所有本地图片和视频引用都需要重新绑定。`
            : "工程已导入。节点、角色和供应商顺序已恢复，所有本地图片和视频引用都需要重新绑定。",
      });

      requestAnimationFrame(() => {
        reactFlowRef.current?.fitView({
          duration: 240,
          padding: 0.24,
        });
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "导入工程失败，请检查 JSON 文件格式。",
      });
    }
  }

  function handleExportProjectJson() {
    const project = serializeProject(nodes, edges, characters, scenes, settings);
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    downloadBlobFile(blob, `interactive-project-v${PROJECT_VERSION}.json`);

    setNotice({
      tone: "success",
      message: "工程 JSON 已导出。",
    });
  }

  function handleExportInteractivePackage() {
    try {
      const bundle = buildInteractiveExportBundle({
        nodes,
        edges,
        characters,
      });
      const blob = new Blob([bundle.content], {
        type: "text/html;charset=utf-8",
      });

      downloadBlobFile(blob, bundle.fileName);
      setNotice({
        tone: "success",
        message:
          bundle.missingVideoCount > 0
            ? `互动版已导出。共 ${bundle.sceneCount} 个片段，其中 ${bundle.playableSceneCount} 个可播放，${bundle.missingVideoCount} 个会在导出包里显示占位卡。`
            : `互动版已导出。共 ${bundle.sceneCount} 个片段，全部可播放。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "导出互动版失败。",
      });
    }
  }

  function handleExportTraversalPackage() {
    try {
      const bundles = buildTraversalExportBundles({
        nodes,
        edges,
        characters,
      });
      bundles.forEach((bundle, index) => {
        const blob = new Blob([bundle.content], {
          type: "text/html;charset=utf-8",
        });

        window.setTimeout(() => {
          downloadBlobFile(blob, bundle.fileName);
        }, index * 80);
      });

      const totalSceneCount = bundles.reduce(
        (sum, bundle) => sum + bundle.sceneCount,
        0,
      );
      const totalPlayableCount = bundles.reduce(
        (sum, bundle) => sum + bundle.playableSceneCount,
        0,
      );
      const totalMissingCount = bundles.reduce(
        (sum, bundle) => sum + bundle.missingVideoCount,
        0,
      );

      setNotice({
        tone: "success",
        message:
          totalMissingCount > 0
            ? `已导出 ${bundles.length} 条路径 HTML。共 ${totalSceneCount} 个片段，其中 ${totalPlayableCount} 个可播放，缺失片段会自动跳过占位。`
            : `已导出 ${bundles.length} 条路径 HTML。共 ${totalSceneCount} 个片段，全部可播放。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "导出全分支遍历版失败。",
      });
    }
  }

  async function requestAgentDraft(
    storyText: string,
    feedback: string,
    imageUrl?: string,
  ) {
    const response = await fetch("/api/agent/draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storyText,
        feedback,
        imageUrl,
        apiKey: agentApiKey,
      }),
    });
    const result = (await response.json()) as AgentDraft & { message?: string };

    if (!response.ok) {
      throw new Error(result.message ?? "Agent 草案生成失败。");
    }

    return result;
  }

  async function handleGenerateAgentDraft() {
    const storyText = agentStoryText.trim();
    const feedback = agentFeedbackText.trim();
    const imageUrl = agentImageUrl.trim();

    if (storyText.length === 0 && imageUrl.length === 0) {
      setNotice({
        tone: "error",
        message: "请先输入故事模板或上传图片。",
      });
      return;
    }

    setIsGeneratingAgentDraft(true);

    try {
      const result = await requestAgentDraft(storyText, feedback, imageUrl);

      setAgentDraft(result);
      setAgentScreenplay(null);
      setNotice({
        tone: "success",
        message: `Agent 已生成「${result.storyTitle}」草案。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Agent 草案生成失败。",
      });
    } finally {
      setIsGeneratingAgentDraft(false);
    }
  }

  async function requestAgentScreenplay(
    storyText: string,
    feedback: string,
    draft: AgentDraft | null,
  ) {
    const response = await fetch("/api/agent/script", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storyText,
        feedback,
        draft,
        apiKey: agentApiKey,
      }),
    });
    const result = (await response.json()) as AgentScreenplay & { message?: string };

    if (!response.ok) {
      throw new Error(result.message ?? "Agent 剧本生成失败。");
    }

    return result;
  }

  async function handleGenerateAgentScreenplay() {
    const storyText = agentStoryText.trim();
    const feedback = agentFeedbackText.trim();

    if (storyText.length === 0) {
      setNotice({
        tone: "error",
        message: "请先输入故事模板。",
      });
      return;
    }

    setIsGeneratingAgentScreenplay(true);
    setNotice({
      tone: "success",
      message: "正在生成剧本...",
    });

    try {
      const result = await requestAgentScreenplay(storyText, feedback, agentDraft);

      setAgentScreenplay(result);
      setNotice({
        tone: "success",
        message: `Agent 已生成「${result.title}」剧本。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Agent 剧本生成失败。",
      });
    } finally {
      setIsGeneratingAgentScreenplay(false);
    }
  }

  async function handleGenerateRandomAgentStory() {
    const storyText = createRandomStoryTemplate();

    setAgentStoryText(storyText);
    setAgentFeedbackText("");
    setAgentDraft(null);
    setAgentScreenplay(null);
    setIsGeneratingRandomAgentStory(true);
    setNotice({
      tone: "success",
      message: "正在随机生成剧本...",
    });

    try {
      setIsGeneratingAgentDraft(true);
      const nextDraft = await requestAgentDraft(storyText, "");
      setAgentDraft(nextDraft);
      setIsGeneratingAgentDraft(false);

      setIsGeneratingAgentScreenplay(true);
      const nextScreenplay = await requestAgentScreenplay(storyText, "", nextDraft);
      setAgentScreenplay(nextScreenplay);
      setNotice({
        tone: "success",
        message: `已随机生成「${nextScreenplay.title}」。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "随机剧本生成失败。",
      });
    } finally {
      setIsGeneratingRandomAgentStory(false);
      setIsGeneratingAgentDraft(false);
      setIsGeneratingAgentScreenplay(false);
    }
  }

  async function handleCopyAgentScreenplay() {
    if (!agentScreenplay?.script) {
      return;
    }

    try {
      await navigator.clipboard.writeText(agentScreenplay.script);
      setNotice({
        tone: "success",
        message: "剧本已复制到剪贴板。",
      });
    } catch {
      setNotice({
        tone: "error",
        message: "复制剧本失败，请手动选择文本复制。",
      });
    }
  }

  function handleApplyAgentDraft() {
    if (!agentDraft) {
      return;
    }

    const nextGraph = applyAgentDraftToEditorGraph(agentDraft);

    cleanupAllAssets();

    startTransition(() => {
      setNodes(nextGraph.nodes);
      setEdges(nextGraph.edges);
      setCharacters(nextGraph.characters);
      setScenes(nextGraph.scenes);
      setSelectedNodeId(null);
      setSelectedCharacterId(null);
      setSelectedSceneId(null);
      setSelectedEdgeId(null);
      setIsAgentModeOpen(false);
    });

    setNotice({
      tone: "success",
      message: `已将 Agent 草案「${agentDraft.storyTitle}」应用到画布。`,
    });

    requestAnimationFrame(() => {
      reactFlowRef.current?.fitView({
        duration: 220,
        padding: 0.24,
      });
    });
  }

  function handleDeleteSelectedNode() {
    if (!selectedNode) {
      return;
    }

    const assetId = selectedNode.data.assetRef?.assetId;

    if (assetId) {
      revokeAssetsById([assetId]);
    }

    setNodes((currentNodes) =>
      currentNodes.filter((node) => node.id !== selectedNode.id),
    );
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) =>
          edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    );
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNotice({
      tone: "success",
      message: `已删除节点「${selectedNode.data.title}」。`,
    });
  }

  function updateEdgeConditionVariable(edgeId: string, conditionVariable: string) {
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === edgeId
          ? {
              ...edge,
              data: {
                ...edge.data,
                conditionVariable,
              },
              label: createConditionLabel(
                conditionVariable || "未设置",
                edge.data?.choiceLabel,
              ),
            }
          : edge,
      ),
    );
  }

  function updateEdgeChoiceLabel(edgeId: string, choiceLabel: string) {
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === edgeId
          ? {
              ...edge,
              data: {
                ...edge.data,
                conditionVariable: edge.data?.conditionVariable ?? "",
                choiceLabel,
              },
              label: createConditionLabel(
                edge.data?.conditionVariable ?? "",
                choiceLabel,
              ),
            }
          : edge,
      ),
    );
  }

  function normalizeSelectedEdgeCondition() {
    if (!selectedEdge) {
      return;
    }

    const currentVariable = selectedEdge.data?.conditionVariable ?? "";

    if (currentVariable.trim().length > 0) {
      return;
    }

    const choiceLabelSlug = selectedEdge.data?.choiceLabel
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const fallbackVariable = choiceLabelSlug
      ? `choice_${choiceLabelSlug}`
      : createConditionVariable(
          edges.findIndex((edge) => edge.id === selectedEdge.id) + 1 || 1,
        );

    updateEdgeConditionVariable(selectedEdge.id, fallbackVariable);
    setNotice({
      tone: "error",
      message: "条件变量不能为空，已恢复默认变量名。",
    });
  }

  function handleDeleteSelectedEdge() {
    if (!selectedEdge) {
      return;
    }

    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.id !== selectedEdge.id),
    );
    setSelectedEdgeId(null);
    setNotice({
      tone: "success",
      message: "已删除当前过渡。",
    });
  }

  function handleAddCharacter() {
    const nextCharacter = createCharacterDefinition(characters.length + 1, {
      id: buildUniqueCharacterId(`character_${characters.length + 1}`, characters),
    });

    setCharacters((currentCharacters) => [...currentCharacters, nextCharacter]);
    setSelectedCharacterId(nextCharacter.id);
    setSelectedNodeId(null);
    setSelectedSceneId(null);
    setSelectedEdgeId(null);
    requestAnimationFrame(() => {
      reactFlowRef.current?.fitView({
        duration: 180,
        padding: 0.24,
      });
    });

    setNotice({
      tone: "success",
      message: "已新增一个角色。",
    });
  }

  function handleCharacterFieldChange(
    characterId: string,
    field: keyof Pick<CharacterDefinition, "name" | "bio" | "basePrompt">,
    value: string,
  ) {
    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              [field]: value,
            }
          : character,
      ),
    );
  }

  function handleCharacterImageModelChange(
    characterId: string,
    imageModel: ImageGenerationModel,
  ) {
    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              imageModel,
            }
          : character,
      ),
    );
  }

  function handleCharacterIdChange(characterId: string, value: string) {
    const nextId = buildUniqueCharacterId(value, characters, characterId);

    setCharacters((currentCharacters) =>
      currentCharacters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              id: nextId,
            }
          : character,
      ),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          actions: node.data.actions.map((action) =>
            action.characterId === characterId
              ? {
                  ...action,
                  characterId: nextId,
                }
              : action,
          ),
          generation: {
            ...node.data.generation,
            referenceCharacterIds: node.data.generation.referenceCharacterIds.map(
              (referenceCharacterId) =>
                referenceCharacterId === characterId ? nextId : referenceCharacterId,
            ),
          },
        },
      })),
    );

    if (selectedCharacterId === characterId) {
      setSelectedCharacterId(nextId);
    }
  }

  function handleDeleteCharacter(characterId: string) {
    const targetCharacter = characters.find(
      (character) => character.id === characterId,
    );

    if (!targetCharacter) {
      return;
    }

    revokeAssetsById(
      targetCharacter.referenceImageAssetRefs.map((assetRef) => assetRef.assetId),
    );

    setCharacters((currentCharacters) =>
      currentCharacters.filter((character) => character.id !== characterId),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          actions: node.data.actions.map((action) =>
            action.characterId === characterId
              ? {
                  ...action,
                  characterId: "",
                }
              : action,
          ),
          generation: {
            ...node.data.generation,
            referenceCharacterIds: node.data.generation.referenceCharacterIds.filter(
              (referenceCharacterId) => referenceCharacterId !== characterId,
            ),
          },
        },
      })),
    );

    if (selectedCharacterId === characterId) {
      setSelectedCharacterId(null);
    }

    setNotice({
      tone: "success",
      message: `已删除角色「${targetCharacter.name}」。`,
    });
  }

  async function handleSceneImageChange(
    sceneId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const invalidFile = files.find((file) => !file.type.startsWith("image/"));

    if (invalidFile) {
      setNotice({
        tone: "error",
        message: `「${invalidFile.name}」不是图片文件。`,
      });
      return;
    }

    const runtimeEntries = files.map((file) => {
      const assetId = crypto.randomUUID();

      return {
        assetRef: {
          assetId,
          fileName: file.name,
          mimeType: file.type || undefined,
          kind: "image" as const,
        },
        runtimeAsset: {
          file,
          objectUrl: URL.createObjectURL(file),
          kind: "image" as const,
        },
      };
    });

    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              referenceImageAssetRefs: [
                ...runtimeEntries.map((entry) => entry.assetRef),
                ...scene.referenceImageAssetRefs,
              ],
            }
          : scene,
      ),
    );
    setAssetRuntimeMap((currentMap) => {
      const nextMap = { ...currentMap };

      for (const entry of runtimeEntries) {
        nextMap[entry.assetRef.assetId] = entry.runtimeAsset;
      }

      return nextMap;
    });
    setNotice({
      tone: "success",
      message: `已为场景补充 ${files.length} 张参考图。`,
    });
  }

  async function handleGenerateSceneImage(scene: SceneDefinition) {
    if (!providerCredentials.doubao.apiKey.trim()) {
      setNotice({
        tone: "error",
        message: "请先配置火山 API Key。",
      });
      return;
    }

    const prompt = buildSceneImagePrompt({
      name: scene.name,
      description: scene.description,
      basePrompt: scene.basePrompt,
    });

    try {
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: providerCredentials.doubao.apiKey,
          prompt,
          model: scene.imageModel,
        }),
      });
      const result = (await response.json()) as {
        b64Json?: string;
        mimeType?: string;
        message?: string;
      };

      if (!response.ok || !result.b64Json) {
        throw new Error(result.message ?? "场景生图失败。");
      }

      const file = await dataUrlToFile(
        `data:${result.mimeType ?? "image/png"};base64,${result.b64Json}`,
        `${scene.id}-${Date.now()}.png`,
      );
      const assetId = crypto.randomUUID();

      setScenes((currentScenes) =>
        currentScenes.map((currentScene) =>
          currentScene.id === scene.id
            ? {
                ...currentScene,
                referenceImageAssetRefs: [
                  {
                    assetId,
                    fileName: file.name,
                    mimeType: file.type || undefined,
                    kind: "image",
                  },
                  ...currentScene.referenceImageAssetRefs,
                ],
              }
            : currentScene,
        ),
      );
      setAssetRuntimeMap((currentMap) => ({
        ...currentMap,
        [assetId]: {
          file,
          objectUrl: URL.createObjectURL(file),
          kind: "image",
        },
      }));
      setNotice({
        tone: "success",
        message: `已为「${scene.name}」生成场景参考图。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "场景生图失败。",
      });
    }
  }

  function removeSceneReferenceAsset(sceneId: string, assetId: string) {
    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              referenceImageAssetRefs: scene.referenceImageAssetRefs.filter(
                (assetRef) => assetRef.assetId !== assetId,
              ),
            }
          : scene,
      ),
    );
    revokeAssetsById([assetId]);
  }

  function attachExistingImageToScene(sceneId: string, assetId: string) {
    const runtimeAsset = assetRuntimeMap[assetId];

    if (!runtimeAsset || runtimeAsset.kind !== "image") {
      return;
    }

    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? scene.referenceImageAssetRefs.some((assetRef) => assetRef.assetId === assetId)
            ? scene
            : {
                ...scene,
                referenceImageAssetRefs: [
                  {
                    assetId,
                    fileName: runtimeAsset.file.name,
                    mimeType: runtimeAsset.file.type || undefined,
                    kind: "image",
                  },
                  ...scene.referenceImageAssetRefs,
                ],
              }
          : scene,
      ),
    );
  }

  function handleAddScenePreset() {
    const nextScene = createSceneDefinition(scenes.length + 1, {
      id: buildUniqueSceneId(`scene_ref_${scenes.length + 1}`, scenes),
    });

    setScenes((currentScenes) => [...currentScenes, nextScene]);
    setSelectedSceneId(nextScene.id);
    setSelectedCharacterId(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    requestAnimationFrame(() => {
      reactFlowRef.current?.fitView({
        duration: 180,
        padding: 0.24,
      });
    });
    setNotice({
      tone: "success",
      message: "已新增一个场景卡。",
    });
  }

  function handleSceneFieldChange(
    sceneId: string,
    field: keyof Pick<SceneDefinition, "name" | "description" | "basePrompt">,
    value: string,
  ) {
    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              [field]: value,
            }
          : scene,
      ),
    );
  }

  function handleSceneImageModelChange(sceneId: string, imageModel: ImageGenerationModel) {
    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              imageModel,
            }
          : scene,
      ),
    );
  }

  function handleSceneIdChange(sceneId: string, value: string) {
    const nextId = buildUniqueSceneId(value, scenes, sceneId);

    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              id: nextId,
            }
          : scene,
      ),
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          generation: {
            ...node.data.generation,
            referenceSceneIds: node.data.generation.referenceSceneIds.map((referenceSceneId) =>
              referenceSceneId === sceneId ? nextId : referenceSceneId,
            ),
          },
        },
      })),
    );

    if (selectedSceneId === sceneId) {
      setSelectedSceneId(nextId);
    }
  }

  function handleDeleteScene(sceneId: string) {
    const targetScene = scenes.find((scene) => scene.id === sceneId);

    if (!targetScene) {
      return;
    }

    revokeAssetsById(targetScene.referenceImageAssetRefs.map((assetRef) => assetRef.assetId));
    setScenes((currentScenes) => currentScenes.filter((scene) => scene.id !== sceneId));
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          generation: {
            ...node.data.generation,
            referenceSceneIds: node.data.generation.referenceSceneIds.filter(
              (referenceSceneId) => referenceSceneId !== sceneId,
            ),
          },
        },
      })),
    );

    if (selectedSceneId === sceneId) {
      setSelectedSceneId(null);
    }

    setNotice({
      tone: "success",
      message: `已删除场景「${targetScene.name}」。`,
    });
  }

  function handleAddAction(nodeId: string) {
    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        actions: [
          ...node.data.actions,
          createSceneAction({
            characterId: characters[0]?.id ?? "",
          }),
        ],
      },
    }));
  }

  function handleActionChange(
    nodeId: string,
    actionId: string,
    field: keyof Omit<SceneAction, "id">,
    value: string,
  ) {
    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        actions: node.data.actions.map((action) =>
          action.id === actionId
            ? {
                ...action,
                [field]: value,
              }
            : action,
        ),
      },
    }));
  }

  function handleRemoveAction(nodeId: string, actionId: string) {
    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        actions: node.data.actions.filter((action) => action.id !== actionId),
      },
    }));
  }

  function handleGenerationConfigChange(
    nodeId: string,
    field: keyof EditorFlowNode["data"]["generation"],
    value:
      | string
      | number
      | string[]
      | GenerationProviderSelection,
  ) {
    updateNode(nodeId, (node) => {
      const nextGeneration = {
        ...node.data.generation,
        [field]: value,
      } as EditorFlowNode["data"]["generation"];
      const currentProviderId =
        node.data.generation.providerId === "auto"
          ? "doubao"
          : node.data.generation.providerId;

      if (
        field === "providerId" &&
        value !== "auto" &&
        (!node.data.generation.model ||
          node.data.generation.model ===
            getProviderDefaultModel(
              currentProviderId,
              node.data.generation.mode,
            ))
      ) {
        nextGeneration.model = getProviderDefaultModel(
          value as VideoProviderId,
          nextGeneration.mode,
        );
      }

      if (
        field === "mode" &&
        nextGeneration.providerId !== "auto" &&
        (!node.data.generation.model ||
          node.data.generation.model ===
            getProviderDefaultModel(
              currentProviderId,
              node.data.generation.mode,
            ))
      ) {
        nextGeneration.model = getProviderDefaultModel(
          nextGeneration.providerId,
          value as EditorFlowNode["data"]["generation"]["mode"],
        );
      }

      return {
        ...node,
        data: {
          ...node.data,
          generation: nextGeneration,
        },
      };
    });
  }

  function toggleReferenceCharacter(nodeId: string, characterId: string) {
    updateNode(nodeId, (node) => {
      const alreadySelected = node.data.generation.referenceCharacterIds.includes(
        characterId,
      );

      return {
        ...node,
        data: {
          ...node.data,
          generation: {
            ...node.data.generation,
            referenceCharacterIds: alreadySelected
              ? node.data.generation.referenceCharacterIds.filter(
                  (item) => item !== characterId,
                )
              : [...node.data.generation.referenceCharacterIds, characterId],
          },
        },
      };
    });
  }

  function toggleReferenceScene(nodeId: string, sceneId: string) {
    updateNode(nodeId, (node) => {
      const alreadySelected = node.data.generation.referenceSceneIds.includes(sceneId);

      return {
        ...node,
        data: {
          ...node.data,
          generation: {
            ...node.data.generation,
            referenceSceneIds: alreadySelected
              ? node.data.generation.referenceSceneIds.filter((item) => item !== sceneId)
              : [...node.data.generation.referenceSceneIds, sceneId],
          },
        },
      };
    });
  }

  async function collectReferenceImages(node: EditorFlowNode) {
    const uniqueCharacterIds = Array.from(
      new Set(
        [
          ...node.data.generation.referenceCharacterIds,
          ...node.data.actions
            .map((action) => action.characterId)
            .filter((characterId) => characterId.trim().length > 0),
        ].filter(Boolean),
      ),
    );
    const referenceAssets = uniqueCharacterIds
      .map((characterId) =>
        characters.find((character) => character.id === characterId),
      )
      .filter((character): character is CharacterDefinition => Boolean(character))
      .flatMap((character) => character.referenceImageAssetRefs)
      .concat(
        node.data.generation.referenceSceneIds
          .map((sceneId) => scenes.find((scene) => scene.id === sceneId))
          .filter((scene): scene is SceneDefinition => Boolean(scene))
          .flatMap((scene) => scene.referenceImageAssetRefs),
      )
      .slice(0, 4);

    const imageFiles = referenceAssets
      .map((assetRef) => assetRuntimeMap[assetRef.assetId]?.file)
      .filter((file): file is File => Boolean(file));

    return Promise.all(imageFiles.map((file) => readFileAsDataUrl(file)));
  }

  async function handleGenerateVideo(nodeId: string) {
    const node = nodes.find((item) => item.id === nodeId);

    if (!node) {
      return;
    }

    const referenceImages = await collectReferenceImages(node);

    if (
      node.data.generation.mode === "image-to-video" &&
      referenceImages.length === 0
    ) {
      setNotice({
        tone: "error",
        message: "图生视频至少需要一个角色参考图。请先在角色面板上传图片。",
      });
      return;
    }

    const requestBody: UnifiedVideoGenerationRequest = {
      prompt: buildNodePrompt(node, characters, scenes),
      mode: node.data.generation.mode,
      aspectRatio: node.data.generation.aspectRatio,
      durationSec: node.data.generation.durationSec,
      resolution: node.data.generation.resolution,
      model: node.data.generation.model || undefined,
      firstFrameImage: referenceImages[0],
      referenceImages,
    };

    updateNode(nodeId, (currentNode) => ({
      ...currentNode,
      data: {
        ...currentNode.data,
        assetStatus: "generating",
        generationTask: {
          providerId:
            currentNode.data.generation.providerId === "auto"
              ? settings.providerPriority[0]
              : currentNode.data.generation.providerId,
          taskId: "pending",
          status: "queued",
          submittedAt: new Date().toISOString(),
        },
      },
    }));

    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId: node.data.generation.providerId,
          providerPriority: settings.providerPriority,
          credentials: providerCredentials,
          request: requestBody,
        }),
      });
      const result = (await response.json()) as UnifiedVideoCreateResponse & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "创建生成任务失败。");
      }

      const hasGeneratedVideo =
        result.status === "succeeded" &&
        typeof result.videoUrl === "string" &&
        result.videoUrl.trim().length > 0;

      updateNode(nodeId, (currentNode) => ({
        ...currentNode,
        data: {
          ...currentNode.data,
          generatedVideoUrl: hasGeneratedVideo ? result.videoUrl : undefined,
          generatedCoverUrl: hasGeneratedVideo ? result.coverUrl : undefined,
          generationTask: {
            providerId: result.providerId,
            taskId: result.taskId,
            status:
              hasGeneratedVideo
                ? "succeeded"
                : result.status === "failed"
                  ? "failed"
                  : "processing",
            rawStatus: result.rawStatus,
            errorMessage: result.errorMessage,
            submittedAt: new Date().toISOString(),
          },
          assetStatus:
            hasGeneratedVideo
              ? "generated"
              : result.status === "failed"
                ? "failed"
                : "generating",
        },
      }));

      setNotice({
        tone: "success",
        message: `已提交「${node.data.title}」的视频生成任务，当前 provider：${PROVIDER_DEFINITIONS[result.providerId].label}。`,
      });
    } catch (error) {
      updateNode(nodeId, (currentNode) => ({
        ...currentNode,
        data: {
          ...currentNode.data,
          generationTask: currentNode.data.generationTask
            ? {
                ...currentNode.data.generationTask,
                status: "failed",
                errorMessage:
                  error instanceof Error ? error.message : "创建任务失败。",
              }
            : undefined,
          assetStatus: "failed",
        },
      }));
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "视频生成任务创建失败。",
      });
    }
  }

  const sceneFlowNodes = useMemo<EditorFlowNode[]>(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          previewUrl: getNodePreviewUrl(node, assetRuntimeMap),
          onTitleChange: handleNodeTitleChange,
        },
      })),
    [assetRuntimeMap, handleNodeTitleChange, nodes],
  );

  const flowNodes = useMemo<CanvasFlowNode[]>(
    () => [...characterCanvasNodes, ...sceneCanvasNodes, ...sceneFlowNodes],
    [characterCanvasNodes, sceneCanvasNodes, sceneFlowNodes],
  );

  const configuredProviders = getConfiguredProviderPriority(
    providerCredentials,
    settings.providerPriority,
  );
  const assetLibraryItems = useMemo(
    () =>
      Object.entries(assetRuntimeMap).map(([assetId, runtimeAsset]) => {
        const linkedCharacters = characters.filter((character) =>
          character.referenceImageAssetRefs.some((assetRef) => assetRef.assetId === assetId),
        );
        const linkedScenes = scenes.filter((scene) =>
          scene.referenceImageAssetRefs.some((assetRef) => assetRef.assetId === assetId),
        );
        const linkedNode = nodes.find((node) => node.data.assetRef?.assetId === assetId);

        return {
          assetId,
          kind: runtimeAsset.kind,
          objectUrl: runtimeAsset.objectUrl,
          fileName: runtimeAsset.file.name,
          linkedCharacters,
          linkedScenes,
          linkedNode,
        };
      }),
    [assetRuntimeMap, characters, nodes, scenes],
  );
  const selectedNodePreviewUrl = selectedNode
    ? getNodePreviewUrl(selectedNode, assetRuntimeMap)
    : undefined;
  const selectedCharacterPreviewUrl = selectedCharacter
    ? getCharacterPreviewUrl(selectedCharacter, assetRuntimeMap)
    : REFERENCE_PLACEHOLDER_SVG;
  const selectedScenePreviewUrl = selectedScene
    ? getScenePreviewUrl(selectedScene, assetRuntimeMap)
    : SCENE_PLACEHOLDER_SVG;

  return (
    <div className={styles.page}>
      <div
        className={styles.layout}
        style={{
          '--sidebar-width': sidebarResizer.collapsed ? '0px' : `${sidebarResizer.width}px`,
          '--details-width': detailsResizer.collapsed ? '0px' : `${detailsResizer.width}px`,
        } as React.CSSProperties}
      >
        <aside className={`${styles.panel} ${styles.sidebar} ${sidebarResizer.collapsed ? styles.panelCollapsed : ''}`}>
          <section className={styles.hero}>
            <span className={styles.sectionTitle}>PencilStudio</span>
            <h1 className={styles.heroTitle}>PencilStudio-VideoGame</h1>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>操作</h2>
            <div className={styles.actionGrid}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleAddNode}
              >
                添加视频节点
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setIsExportModalOpen(true)}
              >
                导出设置
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleLoadDemoCase}
              >
                加载 Demo Case
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setIsAgentModeOpen(true)}
              >
                Agent 模式
              </button>
              <input
                ref={importInputRef}
                className={styles.hiddenInput}
                type="file"
                accept="application/json"
                onChange={handleImportChange}
              />
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.inlineHeader}>
              <h2 className={styles.sectionTitle}>角色面板</h2>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={handleAddCharacter}
              >
                新增角色
              </button>
            </div>

            <div className={styles.characterList}>
              {characters.length === 0 ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyStateTitle}>暂无角色</p>
                </div>
              ) : (
                characters.map((character) => (
                  <article key={character.id} className={styles.characterCard}>
                    <div className={styles.characterCardHeader}>
                      <div className={styles.characterIdentity}>
                        <strong className={styles.characterName}>
                          {character.name || character.id}
                        </strong>
                        <span className={styles.characterIdBadge}>
                          @{character.id}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.miniDangerButton}
                        onClick={() => handleDeleteCharacter(character.id)}
                      >
                        删除
                      </button>
                    </div>

                    <div className={styles.assetGroup}>
                      <div className={styles.referenceStage}>
                        <div className={styles.referenceHero}>
                          <Image
                            className={styles.referenceHeroImage}
                            src={getCharacterPreviewUrl(character, assetRuntimeMap)}
                            alt={character.name || character.id}
                            width={720}
                            height={720}
                            unoptimized
                          />
                          <div className={styles.referenceOverlay}>
                            <span className={styles.referenceBadge}>
                              {character.referenceImageAssetRefs.length > 0
                                ? `${character.referenceImageAssetRefs.length} 张参考图`
                                : "角色参考图区"}
                            </span>
                            <label className={styles.inlineLinkButton}>
                              上传参考图
                              <input
                                className={styles.hiddenInput}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(event) =>
                                  void handleCharacterImageChange(character.id, event)
                                }
                              />
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className={styles.thumbnailGrid}>
                        {character.referenceImageAssetRefs.map((assetRef) => (
                          <div key={assetRef.assetId} className={styles.thumbnailCard}>
                            {assetRuntimeMap[assetRef.assetId]?.objectUrl ? (
                              <Image
                                className={styles.thumbnail}
                                src={assetRuntimeMap[assetRef.assetId]?.objectUrl}
                                alt={assetRef.fileName}
                                width={240}
                                height={240}
                                unoptimized
                              />
                            ) : (
                              <div className={styles.thumbnailMissing}>待重绑</div>
                            )}
                            <button
                              type="button"
                              className={styles.thumbnailDelete}
                              onClick={() =>
                                removeCharacterReferenceAsset(
                                  character.id,
                                  assetRef.assetId,
                                )
                              }
                            >
                              移除
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className={styles.actionGrid}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => {
                            setSelectedCharacterId(character.id);
                            setSelectedNodeId(null);
                            setSelectedSceneId(null);
                            setSelectedEdgeId(null);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void handleGenerateCharacterImage(character)}
                          disabled={generatingCharacterIdSet.has(character.id)}
                        >
                          {generatingCharacterIdSet.has(character.id) ? "生成中..." : "生图"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.inlineHeader}>
              <h2 className={styles.sectionTitle}>场景面板</h2>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={handleAddScenePreset}
              >
                新增场景
              </button>
            </div>

            <div className={styles.characterList}>
              {scenes.length === 0 ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyStateTitle}>暂无场景卡</p>
                </div>
              ) : (
                scenes.map((scene) => (
                  <article key={scene.id} className={styles.characterCard}>
                    <div className={styles.characterCardHeader}>
                      <div className={styles.characterIdentity}>
                        <strong className={styles.characterName}>
                          {scene.name || scene.id}
                        </strong>
                        <span className={styles.characterIdBadge}>#{scene.id}</span>
                      </div>
                      <button
                        type="button"
                        className={styles.miniDangerButton}
                        onClick={() => handleDeleteScene(scene.id)}
                      >
                        删除
                      </button>
                    </div>

                    <div className={styles.assetGroup}>
                      <div className={styles.referenceStage}>
                        <div className={styles.referenceHero}>
                          <Image
                            className={styles.referenceHeroImage}
                            src={getScenePreviewUrl(scene, assetRuntimeMap)}
                            alt={scene.name || scene.id}
                            width={960}
                            height={600}
                            unoptimized
                          />
                          <div className={styles.referenceOverlay}>
                            <span className={styles.referenceBadge}>
                              {scene.referenceImageAssetRefs.length > 0
                                ? `${scene.referenceImageAssetRefs.length} 张参考图`
                                : "场景参考图区"}
                            </span>
                            <label className={styles.inlineLinkButton}>
                              上传参考图
                              <input
                                className={styles.hiddenInput}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(event) =>
                                  void handleSceneImageChange(scene.id, event)
                                }
                              />
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className={styles.actionGrid}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => {
                            setSelectedSceneId(scene.id);
                            setSelectedCharacterId(null);
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void handleGenerateSceneImage(scene)}
                        >
                          生图
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.inlineHeader}>
              <h2 className={styles.sectionTitle}>模型配置</h2>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setIsProviderModalOpen(true)}
              >
                视频 API 设置
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setIsAssetLibraryOpen(true)}
              >
                资产库
              </button>
            </div>
            <div className={styles.providerSummaryCard}>
              <div className={styles.priorityRow}>
                {settings.providerPriority.map((providerId, index) => (
                  <span key={providerId} className={styles.priorityPill}>
                    {index + 1}. {PROVIDER_DEFINITIONS[providerId].label}
                  </span>
                ))}
              </div>
              <div className={styles.providerStatusRow}>
                {settings.providerPriority.map((providerId) => (
                  <span
                    key={providerId}
                    className={`${styles.providerBadge} ${
                      isCredentialConfigured(providerId, providerCredentials)
                        ? styles.providerReady
                        : styles.providerMissing
                    }`}
                  >
                    {PROVIDER_DEFINITIONS[providerId].label}
                    {" · "}
                    {isCredentialConfigured(providerId, providerCredentials)
                      ? "已配置"
                      : "未配置"}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {notice ? (
            <p
              className={`${styles.notice} ${
                notice.tone === "success"
                  ? styles.noticeSuccess
                  : notice.tone === "info"
                    ? styles.noticeInfo
                  : styles.noticeError
              }`}
            >
              {notice.message}
            </p>
          ) : null}
        </aside>

        <div
          className={`${styles.resizeHandle} ${sidebarResizer.isDragging ? styles.resizeHandleActive : ''}`}
          onMouseDown={sidebarResizer.startDrag}
        >
          <button
            type="button"
            className={`${styles.collapseBtn} ${styles.collapseBtnLeft}`}
            onClick={sidebarResizer.toggleCollapse}
            aria-label={sidebarResizer.collapsed ? '展开左侧面板' : '折叠左侧面板'}
          >
            {sidebarResizer.collapsed ? '▶' : '◀'}
          </button>
        </div>

        <section className={`${styles.panel} ${styles.canvasPanel}`}>
          <div className={styles.canvasHeader}>
            <h2 className={styles.canvasTitle}>Story Graph</h2>
          </div>

          <ReactFlow<CanvasFlowNode, EditorFlowEdge>
            className={styles.flow}
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.24 }}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={80}
            onInit={(instance) => {
              reactFlowRef.current = instance;
              requestAnimationFrame(() => {
                instance.fitView({
                  duration: 180,
                  padding: 0.24,
                });
              });
            }}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onConnectEnd={handleConnectEnd}
            onNodeDragStop={(_, node) => {
              if (node.type === CHARACTER_REFERENCE_NODE_TYPE) {
                handleCharacterNodeDragStop(node.id, node.position);
                return;
              }

              if (node.type === SCENE_REFERENCE_NODE_TYPE) {
                handleSceneNodeDragStop(node.id, node.position);
              }
            }}
            onNodeClick={(_, node) => {
              if (node.type === CHARACTER_REFERENCE_NODE_TYPE) {
                setSelectedCharacterId(node.data.characterId);
                setSelectedNodeId(null);
                setSelectedSceneId(null);
              } else if (node.type === SCENE_REFERENCE_NODE_TYPE) {
                setSelectedSceneId(node.data.sceneId);
                setSelectedNodeId(null);
                setSelectedCharacterId(null);
              } else {
                setSelectedNodeId(node.id);
                setSelectedCharacterId(null);
                setSelectedSceneId(null);
              }

              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
              setSelectedCharacterId(null);
              setSelectedSceneId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedCharacterId(null);
              setSelectedSceneId(null);
              setSelectedEdgeId(null);
              closeContextMenu();
            }}
            onPaneContextMenu={handlePaneContextMenu}
            onMoveStart={closeContextMenu}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            minZoom={0.35}
            deleteKeyCode={["Backspace", "Delete"]}
            selectionOnDrag
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="rgba(255, 255, 255, 0.08)" />
            <MiniMap
              pannable
              zoomable
              style={{
                backgroundColor: "rgba(30, 30, 30, 0.95)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            />
            <Controls showInteractive={false} />

            {contextMenu && (
              <div
                className={styles.canvasContextMenu}
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    handleAddNodeAtPosition(contextMenu.flowPosition);
                    closeContextMenu();
                  }}
                >
                  <span className={styles.contextMenuIcon}>▶</span>
                  添加视频节点
                </button>
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    handleAddCharacterAtPosition(contextMenu.flowPosition);
                    closeContextMenu();
                  }}
                >
                  <span className={styles.contextMenuIcon}>👤</span>
                  添加角色卡
                </button>
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    handleAddSceneAtPosition(contextMenu.flowPosition);
                    closeContextMenu();
                  }}
                >
                  <span className={styles.contextMenuIcon}>🏞</span>
                  添加场景卡
                </button>
                <div className={styles.contextMenuDivider} />
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    reactFlowRef.current?.fitView({ duration: 220, padding: 0.24 });
                    closeContextMenu();
                  }}
                >
                  <span className={styles.contextMenuIcon}>⊞</span>
                  适配画布
                </button>
              </div>
            )}
          </ReactFlow>
        </section>

        <div
          className={`${styles.resizeHandle} ${detailsResizer.isDragging ? styles.resizeHandleActive : ''}`}
          onMouseDown={detailsResizer.startDrag}
        >
          <button
            type="button"
            className={`${styles.collapseBtn} ${styles.collapseBtnRight}`}
            onClick={detailsResizer.toggleCollapse}
            aria-label={detailsResizer.collapsed ? '展开右侧面板' : '折叠右侧面板'}
          >
            {detailsResizer.collapsed ? '◀' : '▶'}
          </button>
        </div>

        <aside className={`${styles.panel} ${styles.details} ${detailsResizer.collapsed ? styles.panelCollapsed : ''}`}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>属性面板</h2>

            {selectedNode ? (
              <>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="node-title">
                    节点标题
                  </label>
                  <input
                    id="node-title"
                    className={styles.textInput}
                    value={selectedNode.data.title}
                    onChange={(event) =>
                      handleNodeTitleChange(selectedNode.id, event.target.value)
                    }
                    placeholder="输入节点标题"
                  />
                </div>

                <section className={styles.section}>
                  <div className={styles.inlineHeader}>
                    <h3 className={styles.sectionTitle}>动作脚本</h3>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => handleAddAction(selectedNode.id)}
                    >
                      添加动作
                    </button>
                  </div>

                  <div className={styles.actionList}>
                    {selectedNode.data.actions.length === 0 ? (
                      <div className={styles.emptyState}>
                        <p className={styles.emptyStateTitle}>先写“@谁做什么”</p>
                        <p className={styles.hint}>
                          每一行动作都会进入提示词，供视频模型生成镜头。
                        </p>
                      </div>
                    ) : (
                      selectedNode.data.actions.map((action) => (
                        <article key={action.id} className={styles.actionCard}>
                          <div className={styles.actionCardHeader}>
                            <span className={styles.actionHandle}>
                              @
                              {(
                                (characterNameMap[action.characterId] ??
                                  action.characterId) ||
                                "未指定"
                              )}
                            </span>
                            <button
                              type="button"
                              className={styles.miniDangerButton}
                              onClick={() =>
                                handleRemoveAction(selectedNode.id, action.id)
                              }
                            >
                              移除
                            </button>
                          </div>

                          <div className={styles.field}>
                            <label className={styles.label}>角色</label>
                            <select
                              className={styles.selectInput}
                              value={action.characterId}
                              onChange={(event) =>
                                handleActionChange(
                                  selectedNode.id,
                                  action.id,
                                  "characterId",
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">未指定角色</option>
                              {characters.map((character) => (
                                <option key={character.id} value={character.id}>
                                  {character.name} (@{character.id})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className={styles.field}>
                            <label className={styles.label}>动作</label>
                            <input
                              className={styles.textInput}
                              value={action.action}
                              onChange={(event) =>
                                handleActionChange(
                                  selectedNode.id,
                                  action.id,
                                  "action",
                                  event.target.value,
                                )
                              }
                              placeholder="例如 推门走进房间"
                            />
                          </div>

                          <div className={styles.field}>
                            <label className={styles.label}>情绪 / 状态</label>
                            <input
                              className={styles.textInput}
                              value={action.emotion}
                              onChange={(event) =>
                                handleActionChange(
                                  selectedNode.id,
                                  action.id,
                                  "emotion",
                                  event.target.value,
                                )
                              }
                              placeholder="例如 紧张、克制"
                            />
                          </div>

                          <div className={styles.field}>
                            <label className={styles.label}>台词</label>
                            <textarea
                              className={styles.compactTextArea}
                              value={action.dialogue}
                              onChange={(event) =>
                                handleActionChange(
                                  selectedNode.id,
                                  action.id,
                                  "dialogue",
                                  event.target.value,
                                )
                              }
                              placeholder="可选，写角色说的话。"
                            />
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="node-notes">
                    节点备注
                  </label>
                  <textarea
                    id="node-notes"
                    className={styles.textArea}
                    value={selectedNode.data.shotNotes}
                    onChange={(event) =>
                      updateNode(selectedNode.id, (node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          shotNotes: event.target.value,
                        },
                      }))
                    }
                    placeholder="记录这个镜头的场景描述、摄影需求或氛围要求。"
                  />
                </div>

                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>生成设置</h3>
                  <div className={styles.field}>
                    <label className={styles.label}>生成引擎</label>
                    <select
                      className={styles.selectInput}
                      value={selectedNode.data.generation.providerId}
                      onChange={(event) =>
                        handleGenerationConfigChange(
                          selectedNode.id,
                          "providerId",
                          event.target.value as GenerationProviderSelection,
                        )
                      }
                    >
                      <option value="auto">按项目默认（项目优先级）</option>
                      {settings.providerPriority.map((providerId) => (
                        <option key={providerId} value={providerId}>
                          {PROVIDER_DEFINITIONS[providerId].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.gridTwo}>
                    <div className={styles.field}>
                      <label className={styles.label}>生成模式</label>
                      <select
                        className={styles.selectInput}
                        value={selectedNode.data.generation.mode}
                        onChange={(event) =>
                          handleGenerationConfigChange(
                            selectedNode.id,
                            "mode",
                            event.target.value,
                          )
                        }
                      >
                        <option value="image-to-video">参考图生成视频</option>
                        <option value="text-to-video">纯提示词生成</option>
                      </select>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>模型</label>
                      <input
                        className={styles.textInput}
                        value={selectedNode.data.generation.model}
                        onChange={(event) =>
                          handleGenerationConfigChange(
                            selectedNode.id,
                            "model",
                            event.target.value,
                          )
                        }
                        placeholder={
                          selectedNode.data.generation.providerId === "auto"
                            ? PROVIDER_DEFINITIONS[settings.providerPriority[0]].videoModel
                            : PROVIDER_DEFINITIONS[selectedNode.data.generation.providerId]
                                .videoModel
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.gridTwo}>
                    <div className={styles.field}>
                      <label className={styles.label}>画面比例</label>
                      <select
                        className={styles.selectInput}
                        value={selectedNode.data.generation.aspectRatio}
                        onChange={(event) =>
                          handleGenerationConfigChange(
                            selectedNode.id,
                            "aspectRatio",
                            event.target.value,
                          )
                        }
                      >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                      </select>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>分辨率</label>
                      <select
                        className={styles.selectInput}
                        value={selectedNode.data.generation.resolution}
                        onChange={(event) =>
                          handleGenerationConfigChange(
                            selectedNode.id,
                            "resolution",
                            event.target.value,
                          )
                        }
                      >
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                      </select>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>时长（秒）</label>
                    <input
                      className={styles.textInput}
                      type="number"
                      min={3}
                      max={12}
                      value={selectedNode.data.generation.durationSec}
                      onChange={(event) =>
                        handleGenerationConfigChange(
                          selectedNode.id,
                          "durationSec",
                          Number(event.target.value),
                        )
                      }
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>参考角色</label>
                    <div className={styles.tagGrid}>
                      {characters.length === 0 ? (
                        <p className={styles.hint}>
                          先在左侧角色面板创建角色并上传参考图。
                        </p>
                      ) : (
                        characters.map((character) => {
                          const active =
                            selectedNode.data.generation.referenceCharacterIds.includes(
                              character.id,
                            );

                          return (
                            <button
                              key={character.id}
                              type="button"
                              className={`${styles.tagChip} ${
                                active ? styles.tagChipActive : ""
                              }`}
                              onClick={() =>
                                toggleReferenceCharacter(selectedNode.id, character.id)
                              }
                            >
                              {character.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>参考场景</label>
                    <div className={styles.tagGrid}>
                      {scenes.length === 0 ? (
                        <p className={styles.hint}>
                          先在左侧场景面板创建场景卡并上传参考图。
                        </p>
                      ) : (
                        scenes.map((scene) => {
                          const active =
                            selectedNode.data.generation.referenceSceneIds.includes(
                              scene.id,
                            );

                          return (
                            <button
                              key={scene.id}
                              type="button"
                              className={`${styles.tagChip} ${
                                active ? styles.tagChipActive : ""
                              }`}
                              onClick={() =>
                                toggleReferenceScene(selectedNode.id, scene.id)
                              }
                            >
                              {scene.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>补充提示词</label>
                    <textarea
                      className={styles.compactTextArea}
                      value={selectedNode.data.generation.promptOverride}
                      onChange={(event) =>
                        handleGenerationConfigChange(
                          selectedNode.id,
                          "promptOverride",
                          event.target.value,
                        )
                      }
                      placeholder="可选，补充风格、镜头语言、光影、运镜要求。"
                    />
                  </div>

                  <div className={styles.assetCard}>
                    <p className={styles.assetStatus}>最终提示词预览</p>
                    <pre className={styles.promptPreview}>{selectedNodePrompt}</pre>
                  </div>

                  <div className={styles.assetCard}>
                    <p
                      className={`${styles.assetStatus} ${
                        selectedNode.data.assetStatus === "generated"
                          ? styles.assetReady
                          : selectedNode.data.assetStatus === "generating"
                            ? styles.assetMissing
                            : selectedNode.data.assetStatus === "failed"
                              ? styles.assetUnsupported
                              : styles.assetEmpty
                      }`}
                    >
                      {selectedNode.data.generationTask
                        ? `任务状态：${selectedNode.data.generationTask.status}${
                            selectedNode.data.generationTask.rawStatus
                              ? ` / ${selectedNode.data.generationTask.rawStatus}`
                              : ""
                          }`
                        : "还没有提交生成任务。"}
                    </p>
                    <p className={styles.assetMeta}>
                      当前执行 provider：
                      {selectedNode.data.generation.providerId === "auto"
                        ? configuredProviders[0]
                          ? PROVIDER_DEFINITIONS[configuredProviders[0]].label
                          : "尚未配置 API"
                        : PROVIDER_DEFINITIONS[selectedNode.data.generation.providerId].label}
                    </p>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void handleGenerateVideo(selectedNode.id)}
                    >
                      生成视频
                    </button>
                  </div>
                </section>

                <div className={styles.assetCard}>
                  <p
                    className={`${styles.assetStatus} ${
                      selectedNode.data.assetStatus === "ready" ||
                      selectedNode.data.assetStatus === "generated"
                        ? styles.assetReady
                        : selectedNode.data.assetStatus === "generating"
                          ? styles.assetMissing
                          : selectedNode.data.assetStatus === "missing"
                            ? styles.assetMissing
                            : selectedNode.data.assetStatus === "failed" ||
                                selectedNode.data.assetStatus === "unsupported"
                              ? styles.assetUnsupported
                              : styles.assetEmpty
                    }`}
                  >
                    {formatStatusLabel(selectedNode)}
                  </p>
                  <p className={styles.assetMeta}>
                    本地素材：
                    {selectedNode.data.assetRef?.fileName ?? "未绑定"}
                  </p>
                  <p className={styles.assetMeta}>
                    生成结果：
                    {selectedNode.data.generatedVideoUrl
                      ? "已生成，可预览"
                      : "暂无"}
                  </p>
                  <div className={styles.actionGrid}>
                    <label className={styles.secondaryButton}>
                      绑定本地视频
                      <input
                        className={styles.hiddenInput}
                        type="file"
                        accept="video/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";

                          if (file) {
                            void replaceNodeAsset(selectedNode.id, file);
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => clearNodeAsset(selectedNode.id)}
                    >
                      清空本地视频
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => clearGeneratedVideo(selectedNode.id)}
                    >
                      清空生成结果
                    </button>
                  </div>
                </div>

                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>时间裁剪</h3>
                  <TrimPreview
                    src={selectedNodePreviewUrl}
                    poster={selectedNode.data.generatedCoverUrl}
                    trim={selectedNode.data.trim}
                    onTrimChange={(trim: TrimRange) =>
                      updateNode(selectedNode.id, (node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          trim,
                        },
                      }))
                    }
                  />
                </section>

                <div className={styles.metaList}>
                  <div className={styles.metaRow}>
                    <span>节点 ID</span>
                    <code>{selectedNode.id}</code>
                  </div>
                  <div className={styles.metaRow}>
                    <span>画布位置</span>
                    <code>{formatNodePosition(selectedNode)}</code>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={handleDeleteSelectedNode}
                >
                  删除当前节点
                </button>
              </>
            ) : selectedCharacter ? (
              <>
                <div className={styles.field}>
                  <label className={styles.label}>角色 ID</label>
                  <input
                    className={styles.textInput}
                    value={selectedCharacter.id}
                    onChange={(event) =>
                      handleCharacterIdChange(
                        selectedCharacter.id,
                        event.target.value,
                      )
                    }
                    placeholder="例如 hero_li"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>角色名</label>
                  <input
                    className={styles.textInput}
                    value={selectedCharacter.name}
                    onChange={(event) =>
                      handleCharacterFieldChange(
                        selectedCharacter.id,
                        "name",
                        event.target.value,
                      )
                    }
                    placeholder="例如 李沐"
                  />
                </div>

                <div className={styles.assetCard}>
                  <p className={styles.assetStatus}>画布里的角色参考卡</p>
                  <div className={styles.referenceStage}>
                    <div className={styles.referenceHero}>
                      <Image
                        className={styles.referenceHeroImage}
                        src={selectedCharacterPreviewUrl}
                        alt={selectedCharacter.name || selectedCharacter.id}
                        width={720}
                        height={720}
                        unoptimized
                      />
                      <div className={styles.referenceOverlay}>
                        <span className={styles.referenceBadge}>
                          {selectedCharacter.referenceImageAssetRefs.length > 0
                            ? `${selectedCharacter.referenceImageAssetRefs.length} 张参考图`
                            : "角色参考图区"}
                        </span>
                        <label className={styles.inlineLinkButton}>
                          上传参考图
                          <input
                            className={styles.hiddenInput}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) =>
                              void handleCharacterImageChange(
                                selectedCharacter.id,
                                event,
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>设定</label>
                  <textarea
                    className={styles.compactTextArea}
                    value={selectedCharacter.bio}
                    onChange={(event) =>
                      handleCharacterFieldChange(
                        selectedCharacter.id,
                        "bio",
                        event.target.value,
                      )
                    }
                    placeholder="写外形、年龄感、服装、身份。"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>补充</label>
                  <textarea
                    className={styles.compactTextArea}
                    value={selectedCharacter.basePrompt}
                    onChange={(event) =>
                      handleCharacterFieldChange(
                        selectedCharacter.id,
                        "basePrompt",
                        event.target.value,
                      )
                    }
                    placeholder="写镜头风格、表演偏好、禁忌项。"
                  />
                </div>

                <div className={styles.gridTwo}>
                  <div className={styles.field}>
                    <label className={styles.label}>生图模型</label>
                    <select
                      className={styles.selectInput}
                      value={selectedCharacter.imageModel}
                      onChange={(event) =>
                        handleCharacterImageModelChange(
                          selectedCharacter.id,
                          event.target.value as ImageGenerationModel,
                        )
                      }
                    >
                      {IMAGE_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>操作</label>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void handleGenerateCharacterImage(selectedCharacter)}
                      disabled={generatingCharacterIdSet.has(selectedCharacter.id)}
                    >
                      {generatingCharacterIdSet.has(selectedCharacter.id)
                        ? "正在生图..."
                        : "生成参考图"}
                    </button>
                  </div>
                </div>

                <div className={styles.thumbnailGrid}>
                  {selectedCharacter.referenceImageAssetRefs.length === 0 ? (
                    <div className={styles.thumbnailMissing}>暂无参考图</div>
                  ) : (
                    selectedCharacter.referenceImageAssetRefs.map((assetRef) => (
                      <div key={assetRef.assetId} className={styles.thumbnailCard}>
                        {assetRuntimeMap[assetRef.assetId]?.objectUrl ? (
                          <Image
                            className={styles.thumbnail}
                            src={assetRuntimeMap[assetRef.assetId]?.objectUrl}
                            alt={assetRef.fileName}
                            width={240}
                            height={240}
                            unoptimized
                          />
                        ) : (
                          <div className={styles.thumbnailMissing}>待重绑</div>
                        )}
                        <button
                          type="button"
                          className={styles.thumbnailDelete}
                          onClick={() =>
                            removeCharacterReferenceAsset(
                              selectedCharacter.id,
                              assetRef.assetId,
                            )
                          }
                        >
                          移除
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => handleDeleteCharacter(selectedCharacter.id)}
                >
                  删除当前角色
                </button>
              </>
            ) : selectedScene ? (
              <>
                <div className={styles.field}>
                  <label className={styles.label}>场景 ID</label>
                  <input
                    className={styles.textInput}
                    value={selectedScene.id}
                    onChange={(event) =>
                      handleSceneIdChange(selectedScene.id, event.target.value)
                    }
                    placeholder="例如 station_night"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>场景名</label>
                  <input
                    className={styles.textInput}
                    value={selectedScene.name}
                    onChange={(event) =>
                      handleSceneFieldChange(
                        selectedScene.id,
                        "name",
                        event.target.value,
                      )
                    }
                    placeholder="例如 深夜车站"
                  />
                </div>

                <div className={styles.assetCard}>
                  <p className={styles.assetStatus}>画布里的场景参考卡</p>
                  <div className={styles.referenceStage}>
                    <div className={styles.referenceHero}>
                      <Image
                        className={styles.referenceHeroImage}
                        src={selectedScenePreviewUrl}
                        alt={selectedScene.name || selectedScene.id}
                        width={960}
                        height={600}
                        unoptimized
                      />
                      <div className={styles.referenceOverlay}>
                        <span className={styles.referenceBadge}>
                          {selectedScene.referenceImageAssetRefs.length > 0
                            ? `${selectedScene.referenceImageAssetRefs.length} 张参考图`
                            : "场景参考图区"}
                        </span>
                        <label className={styles.inlineLinkButton}>
                          上传参考图
                          <input
                            className={styles.hiddenInput}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) =>
                              void handleSceneImageChange(selectedScene.id, event)
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>场景设定</label>
                  <textarea
                    className={styles.compactTextArea}
                    value={selectedScene.description}
                    onChange={(event) =>
                      handleSceneFieldChange(
                        selectedScene.id,
                        "description",
                        event.target.value,
                      )
                    }
                    placeholder="写空间关系、时间、天气、色调、关键布景。"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>补充</label>
                  <textarea
                    className={styles.compactTextArea}
                    value={selectedScene.basePrompt}
                    onChange={(event) =>
                      handleSceneFieldChange(
                        selectedScene.id,
                        "basePrompt",
                        event.target.value,
                      )
                    }
                    placeholder="写镜头气质、材质偏好、禁忌元素。"
                  />
                </div>

                <div className={styles.gridTwo}>
                  <div className={styles.field}>
                    <label className={styles.label}>生图模型</label>
                    <select
                      className={styles.selectInput}
                      value={selectedScene.imageModel}
                      onChange={(event) =>
                        handleSceneImageModelChange(
                          selectedScene.id,
                          event.target.value as ImageGenerationModel,
                        )
                      }
                    >
                      {IMAGE_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>操作</label>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void handleGenerateSceneImage(selectedScene)}
                    >
                      生成参考图
                    </button>
                  </div>
                </div>

                <div className={styles.thumbnailGrid}>
                  {selectedScene.referenceImageAssetRefs.length === 0 ? (
                    <div className={styles.thumbnailMissing}>暂无参考图</div>
                  ) : (
                    selectedScene.referenceImageAssetRefs.map((assetRef) => (
                      <div key={assetRef.assetId} className={styles.thumbnailCard}>
                        {assetRuntimeMap[assetRef.assetId]?.objectUrl ? (
                          <Image
                            className={styles.thumbnail}
                            src={assetRuntimeMap[assetRef.assetId]?.objectUrl}
                            alt={assetRef.fileName}
                            width={240}
                            height={240}
                            unoptimized
                          />
                        ) : (
                          <div className={styles.thumbnailMissing}>待重绑</div>
                        )}
                        <button
                          type="button"
                          className={styles.thumbnailDelete}
                          onClick={() =>
                            removeSceneReferenceAsset(selectedScene.id, assetRef.assetId)
                          }
                        >
                          移除
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => handleDeleteScene(selectedScene.id)}
                >
                  删除当前场景
                </button>
              </>
            ) : selectedEdge ? (
              <>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="edge-choice">
                    选项文案
                  </label>
                  <input
                    id="edge-choice"
                    className={styles.textInput}
                    value={selectedEdge.data?.choiceLabel ?? ""}
                    onChange={(event) =>
                      updateEdgeChoiceLabel(
                        selectedEdge.id,
                        event.target.value,
                      )
                    }
                    placeholder="例如 继续主线 / 改走支线"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="edge-condition">
                    过渡条件变量
                  </label>
                  <input
                    id="edge-condition"
                    className={styles.textInput}
                    value={selectedEdge.data?.conditionVariable ?? ""}
                    onChange={(event) =>
                      updateEdgeConditionVariable(
                        selectedEdge.id,
                        event.target.value,
                      )
                    }
                    onBlur={normalizeSelectedEdgeCondition}
                    placeholder="例如 has_ticket"
                  />
                </div>

                <div className={styles.assetCard}>
                  <p className={styles.assetStatus}>过渡信息</p>
                  <p className={styles.assetMeta}>
                    选项：{selectedEdge.data?.choiceLabel?.trim() || "未设置"}
                  </p>
                  <p className={styles.assetMeta}>
                    起点：{nodeTitleMap[selectedEdge.source] ?? selectedEdge.source}
                  </p>
                  <p className={styles.assetMeta}>
                    终点：{nodeTitleMap[selectedEdge.target] ?? selectedEdge.target}
                  </p>
                </div>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={handleDeleteSelectedEdge}
                >
                  删除当前过渡
                </button>
              </>
            ) : (
              <div className={styles.emptyState}>
                <p className={styles.emptyStateTitle}>选择一个节点或过渡</p>
                <p className={styles.hint}>
                  选中剧情节点后可以编辑动作和生成参数；选中角色卡或场景卡后可以维护参考图；选中过渡后可以编辑条件变量。
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>

      {isAgentModeOpen ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => setIsAgentModeOpen(false)}
        >
          <div
            className={`${styles.modalCard} ${styles.agentModalCard}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <span className={styles.sectionTitle}>Agent 模式</span>
                <h2 className={styles.modalTitle}>故事拆解工作台</h2>
                <p className={styles.hint}>
                  输入故事，生成角色、镜头、分支和过渡草案，再应用到画布。
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setIsAgentModeOpen(false)}
                aria-label="关闭 Agent 模式"
              >
                关闭
              </button>
            </div>

            <div className={styles.agentWorkbench}>
              <section className={styles.agentComposer}>
                <div className={styles.field}>
                  <label className={styles.label}>故事模板</label>
                  <textarea
                    className={`${styles.textArea} ${styles.agentStoryInput}`}
                    value={agentStoryText}
                    onChange={(event) => setAgentStoryText(event.target.value)}
                    placeholder="输入完整故事、关键选择点、主要结局方向。"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>参考图片（可选）</label>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={agentImageUrl}
                    onChange={(event) => setAgentImageUrl(event.target.value)}
                    placeholder="输入图片 URL，Agent 将根据图片内容生成故事"
                  />
                  {agentImageUrl && (
                    <div className={styles.agentImagePreview}>
                      <img
                        src={agentImageUrl}
                        alt="预览"
                        className={styles.agentImagePreviewImg}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>给 Agent 的意见</label>
                  <textarea
                    className={`${styles.compactTextArea} ${styles.agentFeedbackInput}`}
                    value={agentFeedbackText}
                    onChange={(event) => setAgentFeedbackText(event.target.value)}
                    placeholder="例如：把女主塑造成更冷静；增加一个失败分支。"
                  />
                </div>

                <div className={styles.agentActionRow}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void handleGenerateRandomAgentStory()}
                    disabled={
                      isGeneratingRandomAgentStory ||
                      isGeneratingAgentDraft ||
                      isGeneratingAgentScreenplay
                    }
                  >
                    {isGeneratingRandomAgentStory ? "随机生成中..." : "随机剧本"}
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void handleGenerateAgentDraft()}
                    disabled={isGeneratingAgentDraft || isGeneratingRandomAgentStory}
                  >
                    {isGeneratingAgentDraft ? "生成中..." : "生成草案"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void handleGenerateAgentDraft()}
                    disabled={
                      isGeneratingAgentDraft ||
                      isGeneratingRandomAgentStory ||
                      (agentStoryText.trim().length === 0 && agentImageUrl.trim().length === 0)
                    }
                  >
                    根据意见重算
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void handleGenerateAgentScreenplay()}
                    disabled={
                      isGeneratingAgentScreenplay ||
                      isGeneratingRandomAgentStory ||
                      (agentStoryText.trim().length === 0 && agentImageUrl.trim().length === 0)
                    }
                  >
                    {isGeneratingAgentScreenplay ? "剧本生成中..." : "生成剧本"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={handleApplyAgentDraft}
                    disabled={!agentDraft}
                  >
                    应用到画布
                  </button>
                </div>
              </section>

              <section className={styles.agentPreviewPane}>
                {agentDraft || agentScreenplay ? (
                  <>
                    {agentDraft ? (
                      <>
                        <article className={styles.agentSummaryCard}>
                          <div className={styles.inlineHeader}>
                            <strong>{agentDraft.storyTitle}</strong>
                            <span className={styles.priorityPill}>
                              {agentDraft.scenes.length} 镜头
                            </span>
                          </div>
                          <p className={styles.hint}>{agentDraft.summary}</p>
                          <div className={styles.agentStatGrid}>
                            <div className={styles.agentStatItem}>
                              <strong>{agentDraft.characters.length}</strong>
                              <span>角色</span>
                            </div>
                            <div className={styles.agentStatItem}>
                              <strong>{agentDraft.scenePresets.length}</strong>
                              <span>场景</span>
                            </div>
                            <div className={styles.agentStatItem}>
                              <strong>{agentDraft.branches.length}</strong>
                              <span>分支</span>
                            </div>
                            <div className={styles.agentStatItem}>
                              <strong>{agentRootSceneCount}</strong>
                              <span>Root</span>
                            </div>
                            <div className={styles.agentStatItem}>
                              <strong>{agentDraft.transitions.length}</strong>
                              <span>连接</span>
                            </div>
                          </div>
                        </article>

                        <div className={styles.agentPreviewGrid}>
                          <div className={styles.agentPreviewColumn}>
                            <article className={styles.agentCard}>
                              <div className={styles.inlineHeader}>
                                <strong>角色</strong>
                                <span className={styles.priorityPill}>
                                  {agentDraft.characters.length}
                                </span>
                              </div>
                              <div className={styles.agentCardList}>
                                {agentDraft.characters.map((character) => (
                                  <div key={character.id} className={styles.agentListItem}>
                                    <div className={styles.agentListHead}>
                                      <strong>{character.name}</strong>
                                      <span className={styles.characterIdBadge}>
                                        @{character.id}
                                      </span>
                                    </div>
                                    <p className={styles.hint}>{character.bio}</p>
                                    <p className={styles.agentPrompt}>
                                      {character.appearancePrompt}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </article>

                            <article className={styles.agentCard}>
                              <div className={styles.inlineHeader}>
                                <strong>分支</strong>
                                <span className={styles.priorityPill}>
                                  {agentDraft.branches.length}
                                </span>
                              </div>
                              <div className={styles.agentBranchGrid}>
                                {agentDraft.branches.map((branch) => (
                                  <div key={branch.id} className={styles.agentListItem}>
                                    <div className={styles.agentListHead}>
                                      <strong>{branch.name}</strong>
                                      <span className={styles.providerBadge}>
                                        {branch.tone}
                                      </span>
                                    </div>
                                    <p className={styles.hint}>
                                      {branch.predictedOutcome}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </article>

                            <article className={styles.agentCard}>
                              <div className={styles.inlineHeader}>
                                <strong>场景预设</strong>
                                <span className={styles.priorityPill}>
                                  {agentDraft.scenePresets.length}
                                </span>
                              </div>
                              <div className={styles.agentCardList}>
                                {agentDraft.scenePresets.map((scenePreset) => (
                                  <div key={scenePreset.id} className={styles.agentListItem}>
                                    <div className={styles.agentListHead}>
                                      <strong>{scenePreset.name}</strong>
                                      <span className={styles.characterIdBadge}>
                                        #{scenePreset.id}
                                      </span>
                                    </div>
                                    <p className={styles.hint}>{scenePreset.description}</p>
                                    <p className={styles.agentPrompt}>
                                      {scenePreset.appearancePrompt}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </article>
                          </div>

                          <div className={styles.agentPreviewColumn}>
                            <article className={styles.agentCard}>
                              <div className={styles.inlineHeader}>
                                <strong>镜头</strong>
                                <span className={styles.priorityPill}>
                                  {agentDraft.scenes.length}
                                </span>
                              </div>
                              <div className={styles.agentSceneGrid}>
                                {agentSceneGroups.map((group) => (
                                  <section
                                    key={group.id}
                                    className={styles.agentSceneGroup}
                                  >
                                    <div className={styles.agentSceneGroupHead}>
                                      <strong>{group.name}</strong>
                                      <span className={styles.providerBadge}>
                                        {group.scenes.length} 镜头
                                      </span>
                                    </div>
                                    <p className={styles.hint}>
                                      {group.predictedOutcome}
                                    </p>
                                    <div className={styles.agentSceneGroupList}>
                                      {group.scenes.map((scene) => (
                                        <div
                                          key={scene.id}
                                          className={styles.agentListItem}
                                        >
                                          <div className={styles.agentListHead}>
                                            <strong>{scene.title}</strong>
                                            <span className={styles.characterIdBadge}>
                                              {group.tone}
                                            </span>
                                          </div>
                                          <p className={styles.hint}>
                                            {scene.summary}
                                          </p>
                                          <p className={styles.agentPrompt}>
                                            {scene.videoPrompt}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </section>
                                ))}
                              </div>
                            </article>

                            <article className={styles.agentCard}>
                              <div className={styles.inlineHeader}>
                                <strong>连接</strong>
                                <span className={styles.priorityPill}>
                                  {agentDraft.transitions.length}
                                </span>
                              </div>
                              <div className={styles.agentCardList}>
                                {agentDraft.transitions.map((transition) => {
                                  const source = agentDraft.scenes.find(
                                    (scene) => scene.id === transition.sourceSceneId,
                                  );
                                  const target = agentDraft.scenes.find(
                                    (scene) => scene.id === transition.targetSceneId,
                                  );

                                  return (
                                    <div key={transition.id} className={styles.agentListItem}>
                                      <div className={styles.agentListHead}>
                                        <strong>{transition.choiceLabel}</strong>
                                        <span className={styles.characterIdBadge}>
                                          {transition.conditionVariable}
                                        </span>
                                      </div>
                                      <p className={styles.hint}>
                                        {source?.title ?? transition.sourceSceneId} →{" "}
                                        {target?.title ?? transition.targetSceneId}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </article>
                          </div>
                        </div>
                      </>
                    ) : null}

                    <article className={styles.agentScriptCard}>
                      <div className={styles.inlineHeader}>
                        <strong>剧本</strong>
                        <div className={styles.agentScriptActions}>
                          {agentScreenplay ? (
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => void handleCopyAgentScreenplay()}
                            >
                              复制
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => void handleGenerateAgentScreenplay()}
                            disabled={
                              isGeneratingAgentScreenplay ||
                              agentStoryText.trim().length === 0
                            }
                          >
                            {isGeneratingAgentScreenplay ? "生成中..." : "生成剧本"}
                          </button>
                        </div>
                      </div>
                      {agentScreenplay ? (
                        <div className={styles.agentScriptBody}>
                          <div className={styles.agentScriptMeta}>
                            <strong>{agentScreenplay.title}</strong>
                            <p className={styles.hint}>{agentScreenplay.logline}</p>
                          </div>
                          <pre className={styles.agentScriptText}>
                            {agentScreenplay.script}
                          </pre>
                        </div>
                      ) : (
                        <div className={styles.emptyState}>
                          <p className={styles.emptyStateTitle}>还没有生成剧本</p>
                          <p className={styles.hint}>
                            先生成草案，或者直接基于故事模板生成一版剧本。
                          </p>
                        </div>
                      )}
                    </article>
                  </>
                ) : (
                  <div className={styles.emptyState}>
                    <p className={styles.emptyStateTitle}>输入故事后生成</p>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isExportModalOpen ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => setIsExportModalOpen(false)}
        >
          <div
            className={styles.exportModalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.exportModalHeader}>
              <div>
                <h2 className={styles.exportModalTitle}>导入 & 导出</h2>
                <p className={styles.exportModalSubtitle}>管理工程文件和成片导出</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setIsExportModalOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className={styles.exportGrid}>
              <article className={styles.exportCard}>
                <div className={styles.exportCardIcon}>📄</div>
                <div className={styles.exportCardBody}>
                  <h3 className={styles.exportCardTitle}>工程 JSON</h3>
                  <p className={styles.exportCardDesc}>
                    导入或导出节点、过渡、角色和场景卡结构
                  </p>
                </div>
                <div className={styles.exportCardActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => importInputRef.current?.click()}
                  >
                    导入
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleExportProjectJson}
                  >
                    导出
                  </button>
                </div>
              </article>

              <article className={styles.exportCard}>
                <div className={styles.exportCardIcon}>🎬</div>
                <div className={styles.exportCardBody}>
                  <h3 className={styles.exportCardTitle}>互动版 HTML</h3>
                  <p className={styles.exportCardDesc}>
                    播完片段后出现选项分支，可直接在浏览器打开体验
                  </p>
                </div>
                <div className={styles.exportCardActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleExportInteractivePackage}
                  >
                    导出互动版
                  </button>
                </div>
              </article>

              <article className={styles.exportCard}>
                <div className={styles.exportCardIcon}>🔀</div>
                <div className={styles.exportCardBody}>
                  <h3 className={styles.exportCardTitle}>全分支遍历版</h3>
                  <p className={styles.exportCardDesc}>
                    每条路径单独导出为独立的纯视频播放页
                  </p>
                </div>
                <div className={styles.exportCardActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleExportTraversalPackage}
                  >
                    导出全分支
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>
      ) : null}

      {isProviderModalOpen ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => setIsProviderModalOpen(false)}
        >
          <div
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <span className={styles.sectionTitle}>API 设置</span>
                <h2 className={styles.modalTitle}>视频生成 API 配置</h2>
                <p className={styles.hint}>
                  这里统一配置豆包、MiniMax、Vidu、Kling 的视频生成凭证。凭证只保存在当前浏览器，不会写进工程 JSON。
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setIsProviderModalOpen(false)}
                aria-label="关闭 API 设置"
              >
                关闭
              </button>
            </div>

            <div className={styles.modalMeta}>
              <div className={styles.priorityRow}>
                {settings.providerPriority.map((providerId, index) => (
                  <span key={providerId} className={styles.priorityPill}>
                    {index + 1}. {PROVIDER_DEFINITIONS[providerId].label}
                  </span>
                ))}
              </div>
              <p className={styles.hint}>
                当前节点若选择“按项目默认”，会按这里的 provider 优先级自动选择已配置凭证。
              </p>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.providerGrid}>
                {settings.providerPriority.map((providerId) => {
                  const provider = PROVIDER_DEFINITIONS[providerId];

                  return (
                    <article key={providerId} className={styles.providerCard}>
                      <div className={styles.providerHead}>
                        <div>
                          <strong>{provider.label}</strong>
                          <p className={styles.providerMeta}>{provider.vendor}</p>
                        </div>
                        <span
                          className={`${styles.providerBadge} ${
                            isCredentialConfigured(providerId, providerCredentials)
                              ? styles.providerReady
                              : styles.providerMissing
                          }`}
                        >
                          {isCredentialConfigured(providerId, providerCredentials)
                            ? "已配置"
                            : "未配置"}
                        </span>
                      </div>
                      <p className={styles.hint}>{provider.description}</p>
                      <p className={styles.providerModel}>
                        默认视频模型：{provider.videoModel}
                      </p>
                      {provider.imageModel ? (
                        <p className={styles.providerModel}>
                          参考图模型：{provider.imageModel}
                        </p>
                      ) : null}
                      {provider.credentialFields.map((field) => (
                        <div key={field.key} className={styles.field}>
                          <label className={styles.label}>{field.label}</label>
                          <input
                            className={styles.textInput}
                            type={field.secret ? "password" : "text"}
                            value={
                              providerCredentials[providerId][
                                field.key as keyof ProviderCredentialState[typeof providerId]
                              ] as string
                            }
                            onChange={(event) =>
                              setProviderCredentials((currentCredentials) => ({
                                ...currentCredentials,
                                [providerId]: {
                                  ...currentCredentials[providerId],
                                  [field.key]: event.target.value,
                                },
                              }))
                            }
                            placeholder={field.placeholder}
                          />
                        </div>
                      ))}
                      <a
                        className={styles.inlineLinkButton}
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开官方文档
                      </a>
                    </article>
                  );
                })}
              </div>

              {/* Agent API Key 配置 */}
              <div className={styles.providerCard} style={{ marginTop: "20px" }}>
                <div className={styles.providerHead}>
                  <div>
                    <strong>Agent API 配置</strong>
                    <p className={styles.providerMeta}>豆包方舟 - 故事生成与剧本创作</p>
                  </div>
                  <span
                    className={`${styles.providerBadge} ${
                      agentApiKey.trim().length > 0
                        ? styles.providerReady
                        : styles.providerMissing
                    }`}
                  >
                    {agentApiKey.trim().length > 0 ? "已配置" : "未配置"}
                  </span>
                </div>
                <p className={styles.hint}>
                  Agent 用于故事拆解和剧本创作。支持图像理解功能。
                  凭证保存在浏览器 localStorage 中。
                </p>
                <div className={styles.field}>
                  <label className={styles.label}>Agent API Key</label>
                  <input
                    className={styles.textInput}
                    type="password"
                    value={agentApiKey}
                    onChange={(event) => {
                      const newKey = event.target.value;
                      setAgentApiKey(newKey);
                      if (typeof window !== "undefined") {
                        if (newKey.trim()) {
                          localStorage.setItem(AGENT_API_KEY_STORAGE_KEY, newKey);
                        } else {
                          localStorage.removeItem(AGENT_API_KEY_STORAGE_KEY);
                        }
                      }
                    }}
                    placeholder="输入豆包方舟 API Key"
                  />
                </div>
                <div className={styles.field}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={async () => {
                      if (!agentApiKey.trim()) {
                        setNotice({
                          tone: "error",
                          message: "请先输入 API Key",
                        });
                        return;
                      }

                      setNotice({
                        tone: "info",
                        message: "正在测试 API Key...",
                      });

                      try {
                        const response = await fetch("/api/agent/test", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({ apiKey: agentApiKey }),
                        });

                        const result = await response.json();

                        if (result.success) {
                          setNotice({
                            tone: "success",
                            message: "✅ API Key 配置正确！可以开始使用 Agent 功能了。",
                          });
                        } else {
                          setNotice({
                            tone: "error",
                            message: `❌ API Key 测试失败：${result.message}`,
                          });
                        }
                      } catch (error) {
                        setNotice({
                          tone: "error",
                          message: `测试失败：${error instanceof Error ? error.message : "未知错误"}`,
                        });
                      }
                    }}
                  >
                    测试 API Key 连接
                  </button>
                </div>
                <a
                  className={styles.inlineLinkButton}
                  href="https://www.volcengine.com/docs/ark"
                  target="_blank"
                  rel="noreferrer"
                >
                  打开官方文档获取 API Key
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAssetLibraryOpen ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => setIsAssetLibraryOpen(false)}
        >
          <div
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <span className={styles.sectionTitle}>资产库</span>
                <h2 className={styles.modalTitle}>图片与视频资产</h2>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setIsAssetLibraryOpen(false)}
                aria-label="关闭资产库"
              >
                关闭
              </button>
            </div>

            <div className={styles.modalBody}>
              {assetLibraryItems.length === 0 ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyStateTitle}>暂无资产</p>
                </div>
              ) : (
                <div className={styles.assetLibraryGrid}>
                  {assetLibraryItems.map((asset) => (
                    <article key={asset.assetId} className={styles.assetLibraryCard}>
                      <div className={styles.assetLibraryMedia}>
                        {asset.kind === "image" ? (
                          <Image
                            className={styles.assetLibraryImage}
                            src={asset.objectUrl}
                            alt={asset.fileName}
                            width={480}
                            height={480}
                            unoptimized
                          />
                        ) : (
                          <video
                            className={styles.assetLibraryVideo}
                            src={asset.objectUrl}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        )}
                      </div>
                      <div className={styles.assetLibraryBody}>
                        <strong className={styles.assetLibraryName}>{asset.fileName}</strong>
                        <p className={styles.assetLibraryMeta}>
                          {asset.kind === "image" ? "图片" : "视频"}
                        </p>
                        {asset.linkedCharacters.length > 0 ? (
                          <p className={styles.assetLibraryMeta}>
                            角色：{asset.linkedCharacters.map((item) => item.name).join("、")}
                          </p>
                        ) : null}
                        {asset.linkedScenes.length > 0 ? (
                          <p className={styles.assetLibraryMeta}>
                            场景：{asset.linkedScenes.map((item) => item.name).join("、")}
                          </p>
                        ) : null}
                        {asset.linkedNode ? (
                          <p className={styles.assetLibraryMeta}>
                            节点：{asset.linkedNode.data.title}
                          </p>
                        ) : null}
                        <div className={styles.actionGrid}>
                          {asset.kind === "image" && selectedCharacter ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() =>
                                attachExistingImageToCharacter(
                                  selectedCharacter.id,
                                  asset.assetId,
                                )
                              }
                            >
                              用于当前角色
                            </button>
                          ) : null}
                          {asset.kind === "image" && selectedScene ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() =>
                                attachExistingImageToScene(
                                  selectedScene.id,
                                  asset.assetId,
                                )
                              }
                            >
                              用于当前场景
                            </button>
                          ) : null}
                          {asset.kind === "video" && selectedNode ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() =>
                                attachExistingVideoToNode(selectedNode.id, asset.assetId)
                              }
                            >
                              用于当前节点
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
