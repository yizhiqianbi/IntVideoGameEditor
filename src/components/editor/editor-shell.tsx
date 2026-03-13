"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
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
import styles from "./editor-shell.module.css";
import {
  CharacterReferenceNode,
  type CharacterReferenceNodeData,
} from "./character-reference-node";
import {
  buildTransitionEdge,
  CHARACTER_REFERENCE_NODE_TYPE,
  createCharacterDefinition,
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
  tone: "success" | "error";
  message: string;
};

type CharacterCanvasNode = Node<
  CharacterReferenceNodeData,
  typeof CHARACTER_REFERENCE_NODE_TYPE
>;

type CanvasFlowNode = EditorFlowNode | CharacterCanvasNode;

const nodeTypes = {
  videoScene: VideoSceneNode,
  characterReference: CharacterReferenceNode,
};

const PROVIDER_STORAGE_KEY = "int-video-game-editor.provider-credentials.v1";
const CHARACTER_NODE_ID_PREFIX = "character-card:";
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

function buildNodePrompt(
  node: EditorFlowNode,
  characters: CharacterDefinition[],
) {
  const characterMap = new Map(characters.map((character) => [character.id, character]));
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
  const [settings, setSettings] = useState<ProjectSettings>({
    providerPriority: [...DEFAULT_PROVIDER_PRIORITY],
  });
  const [providerCredentials, setProviderCredentials] =
    useState<ProviderCredentialState>(DEFAULT_PROVIDER_CREDENTIALS);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [assetRuntimeMap, setAssetRuntimeMap] = useState<
    Record<string, RuntimeAsset>
  >({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const assetRuntimeMapRef = useRef<Record<string, RuntimeAsset>>({});
  const reactFlowRef =
    useRef<ReactFlowInstance<CanvasFlowNode, EditorFlowEdge> | null>(null);

  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedCharacter =
    characters.find((character) => character.id === selectedCharacterId) ?? null;
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
    ? buildNodePrompt(selectedNode, characters)
    : "";

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
                ...character.referenceImageAssetRefs,
                ...runtimeEntries.map((entry) => entry.assetRef),
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

    setNotice({
      tone: "success",
      message: `已为角色补充 ${files.length} 张参考图。`,
    });
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

  useEffect(() => {
    assetRuntimeMapRef.current = assetRuntimeMap;
  }, [assetRuntimeMap]);

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
          apiKey: parsed.doubao?.apiKey ?? "",
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
    if (!isProviderModalOpen) {
      document.body.style.overflow = "";
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProviderModalOpen(false);
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProviderModalOpen]);

  useEffect(() => {
    const pendingNodes = nodes.filter(
      (node) =>
        node.data.generationTask?.status === "queued" ||
        node.data.generationTask?.status === "processing",
    );

    if (pendingNodes.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void Promise.all(
        pendingNodes.map(async (node) => {
          const generationTask = node.data.generationTask;

          if (!generationTask) {
            return;
          }

          try {
            const response = await fetch("/api/video/status", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                providerId: generationTask.providerId,
                taskId: generationTask.taskId,
                credentials: providerCredentials,
              }),
            });
            const result = (await response.json()) as UnifiedVideoCreateResponse & {
              message?: string;
            };

            if (!response.ok) {
              throw new Error(result.message ?? "查询任务状态失败。");
            }

            updateNode(node.id, (currentNode) => ({
              ...currentNode,
              data: {
                ...currentNode.data,
                generatedVideoUrl:
                  result.status === "succeeded"
                    ? result.videoUrl ?? currentNode.data.generatedVideoUrl
                    : currentNode.data.generatedVideoUrl,
                generatedCoverUrl:
                  result.status === "succeeded"
                    ? result.coverUrl ?? currentNode.data.generatedCoverUrl
                    : currentNode.data.generatedCoverUrl,
                generationTask: currentNode.data.generationTask
                  ? {
                      ...currentNode.data.generationTask,
                      status: result.status,
                      rawStatus: result.rawStatus,
                      errorMessage: result.errorMessage,
                    }
                  : undefined,
                assetStatus:
                  result.status === "succeeded"
                    ? "generated"
                    : result.status === "failed"
                      ? "failed"
                      : "generating",
              },
            }));
          } catch (error) {
            updateNode(node.id, (currentNode) => ({
              ...currentNode,
              data: {
                ...currentNode.data,
                generationTask: currentNode.data.generationTask
                  ? {
                      ...currentNode.data.generationTask,
                      status: "failed",
                      errorMessage:
                        error instanceof Error
                          ? error.message
                          : "查询状态失败。",
                    }
                  : undefined,
                assetStatus: "failed",
              },
            }));
          }
        }),
      );
    }, 4500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [nodes, providerCredentials]);

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
  }

  function handleNodesChange(changes: NodeChange<CanvasFlowNode>[]) {
    const sceneChanges: NodeChange<EditorFlowNode>[] = [];
    const characterPositionChanges: Array<{
      characterId: string;
      position: { x: number; y: number };
    }> = [];

    for (const change of changes) {
      if (change.type === "add") {
        sceneChanges.push(change as NodeChange<EditorFlowNode>);
        continue;
      }

      const characterId = parseCharacterIdFromNodeId(change.id);

      if (!characterId) {
        sceneChanges.push(change as NodeChange<EditorFlowNode>);
        continue;
      }

      if (change.type === "position" && change.position) {
        characterPositionChanges.push({
          characterId,
          position: change.position,
        });
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

    if (characterPositionChanges.length > 0) {
      setCharacters((currentCharacters) =>
        currentCharacters.map((character) => {
          const matchingChange = characterPositionChanges.find(
            (change) => change.characterId === character.id,
          );

          if (!matchingChange) {
            return character;
          }

          return {
            ...character,
            canvasPosition: matchingChange.position,
          };
        }),
      );
    }
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
    });

    setEdges((currentEdges) => [...currentEdges, nextEdge]);
    setSelectedNodeId(null);
    setSelectedCharacterId(null);
    setSelectedEdgeId(nextEdge.id);
    setNotice({
      tone: "success",
      message: "已创建过渡，并自动分配条件变量。",
    });
  }

  function handleNodeTitleChange(nodeId: string, title: string) {
    updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        title,
      },
    }));
  }

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
        setSettings(project.settings);
        setSelectedNodeId(null);
        setSelectedCharacterId(null);
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

  function handleExport() {
    const project = serializeProject(nodes, edges, characters, settings);
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = `interactive-project-v${PROJECT_VERSION}.json`;
    link.click();
    URL.revokeObjectURL(objectUrl);

    setNotice({
      tone: "success",
      message: "工程 JSON 已导出。",
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
                conditionVariable,
              },
              label: createConditionLabel(conditionVariable || "未设置"),
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

    const fallbackVariable = createConditionVariable(
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
      prompt: buildNodePrompt(node, characters),
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

      updateNode(nodeId, (currentNode) => ({
        ...currentNode,
        data: {
          ...currentNode.data,
          generatedVideoUrl: result.status === "succeeded" ? result.videoUrl : undefined,
          generatedCoverUrl: result.status === "succeeded" ? result.coverUrl : undefined,
          generationTask: {
            providerId: result.providerId,
            taskId: result.taskId,
            status:
              result.status === "succeeded"
                ? "succeeded"
                : result.status === "failed"
                  ? "failed"
                  : "processing",
            rawStatus: result.rawStatus,
            errorMessage: result.errorMessage,
            submittedAt: new Date().toISOString(),
          },
          assetStatus:
            result.status === "succeeded"
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

  const sceneFlowNodes: EditorFlowNode[] = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      previewUrl: getNodePreviewUrl(node, assetRuntimeMap),
      onTitleChange: handleNodeTitleChange,
    },
  }));

  const characterFlowNodes: CharacterCanvasNode[] = characters.map((character) => {
    const previewAssetId = character.referenceImageAssetRefs[0]?.assetId;
    const previewUrl =
      (previewAssetId ? assetRuntimeMap[previewAssetId]?.objectUrl : undefined) ??
      REFERENCE_PLACEHOLDER_SVG;

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
        isActive: selectedCharacterId === character.id,
      },
      draggable: true,
      selectable: true,
      deletable: false,
      connectable: false,
    };
  });

  const flowNodes: CanvasFlowNode[] = [...characterFlowNodes, ...sceneFlowNodes];

  const configuredProviders = getConfiguredProviderPriority(
    providerCredentials,
    settings.providerPriority,
  );
  const selectedNodePreviewUrl = selectedNode
    ? getNodePreviewUrl(selectedNode, assetRuntimeMap)
    : undefined;
  const selectedCharacterPreviewUrl = selectedCharacter
    ? assetRuntimeMap[selectedCharacter.referenceImageAssetRefs[0]?.assetId ?? ""]?.objectUrl ??
      REFERENCE_PLACEHOLDER_SVG
    : REFERENCE_PLACEHOLDER_SVG;

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <aside className={`${styles.panel} ${styles.sidebar}`}>
          <section className={styles.hero}>
            <span className={styles.sectionTitle}>Interactive Film</span>
            <h1 className={styles.heroTitle}>节点式互动影视编辑器</h1>
            <p className={styles.heroBody}>
              这版已经切成结构化剧情编辑器：角色、镜头动作、参考图、国产视频模型接入和时间裁剪都在同一个工作台里。
            </p>
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
                onClick={() => importInputRef.current?.click()}
              >
                导入工程 JSON
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleExport}
              >
                导出工程 JSON
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
            <p className={styles.hint}>
              每个角色会同步生成一张可拖拽的角色参考卡，直接贴在 Story Graph 画布里。
            </p>

            <div className={styles.characterList}>
              {characters.length === 0 ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyStateTitle}>先建角色，再写动作</p>
                  <p className={styles.hint}>
                    每个角色都有唯一 ID。节点动作里的 `@角色` 和参考图绑定都会引用这个 ID。
                  </p>
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

                    <div className={styles.field}>
                      <label className={styles.label}>角色 ID</label>
                      <input
                        className={styles.textInput}
                        value={character.id}
                        onChange={(event) =>
                          handleCharacterIdChange(character.id, event.target.value)
                        }
                        placeholder="例如 hero_li"
                      />
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>角色名</label>
                      <input
                        className={styles.textInput}
                        value={character.name}
                        onChange={(event) =>
                          handleCharacterFieldChange(
                            character.id,
                            "name",
                            event.target.value,
                          )
                        }
                        placeholder="例如 李沐"
                      />
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>人物设定</label>
                      <textarea
                        className={styles.compactTextArea}
                        value={character.bio}
                        onChange={(event) =>
                          handleCharacterFieldChange(
                            character.id,
                            "bio",
                            event.target.value,
                          )
                        }
                        placeholder="写外形、年龄感、服装、身份。"
                      />
                    </div>

                    <div className={styles.field}>
                      <label className={styles.label}>生成补充</label>
                      <textarea
                        className={styles.compactTextArea}
                        value={character.basePrompt}
                        onChange={(event) =>
                          handleCharacterFieldChange(
                            character.id,
                            "basePrompt",
                            event.target.value,
                          )
                        }
                        placeholder="写镜头风格、表演偏好、禁忌项。"
                      />
                    </div>

                    <div className={styles.assetGroup}>
                      <div className={styles.referenceStage}>
                        <div className={styles.referenceHero}>
                          {character.referenceImageAssetRefs[0] ? (
                            assetRuntimeMap[
                              character.referenceImageAssetRefs[0].assetId
                            ]?.objectUrl ? (
                              <Image
                                className={styles.referenceHeroImage}
                                src={
                                  assetRuntimeMap[
                                    character.referenceImageAssetRefs[0].assetId
                                  ]?.objectUrl ?? ""
                                }
                                alt={character.referenceImageAssetRefs[0].fileName}
                                width={720}
                                height={720}
                                unoptimized
                              />
                            ) : (
                              <div className={styles.referenceHeroMissing}>
                                参考图引用已恢复，等待重新绑定
                              </div>
                            )
                          ) : (
                            <Image
                              className={styles.referenceHeroImage}
                              src={REFERENCE_PLACEHOLDER_SVG}
                              alt="角色参考图占位"
                              width={720}
                              height={720}
                              unoptimized
                            />
                          )}
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

                        <p className={styles.hint}>
                          这里的图会作为参考图生成视频的主要输入。建议先放角色正脸、半身和服装一致性的图。
                        </p>
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
                打开 API 设置
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
              <p className={styles.hint}>
                主界面只保留摘要。具体 API key 在弹窗里配置，避免占用主要创作空间。
              </p>
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

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>统计</h2>
            <div className={styles.stats}>
              <article className={styles.statCard}>
                <span className={styles.statValue}>{nodes.length}</span>
                <span className={styles.statLabel}>节点数量</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>{edges.length}</span>
                <span className={styles.statLabel}>连线数量</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>{characters.length}</span>
                <span className={styles.statLabel}>角色数量</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>{configuredProviders.length}</span>
                <span className={styles.statLabel}>已配置 API</span>
              </article>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>提示</h2>
            <p className={styles.hint}>
              导出的工程文件会保存节点、角色、过渡条件变量和生成参数，但不会打包本地图片或视频。重新导入后，需要重新绑定角色参考图和本地视频。
            </p>
            <p className={styles.hint}>
              “裁剪”当前实现的是时间范围裁剪，只调整预览和后续流程里使用的时间窗口，不会直接修改原始视频文件。
            </p>
          </section>

          {notice ? (
            <p
              className={`${styles.notice} ${
                notice.tone === "success"
                  ? styles.noticeSuccess
                  : styles.noticeError
              }`}
            >
              {notice.message}
            </p>
          ) : null}
        </aside>

        <section className={`${styles.panel} ${styles.canvasPanel}`}>
          <div className={styles.canvasHeader}>
            <h2 className={styles.canvasTitle}>Story Graph</h2>
            <p className={styles.canvasCaption}>
              现在角色也可以贴在 Story Graph 画布里，像参考卡一样自由摆放；剧情节点继续负责分镜和过渡。
            </p>
          </div>

          <ReactFlow<CanvasFlowNode, EditorFlowEdge>
            className={styles.flow}
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.24 }}
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
            onNodeClick={(_, node) => {
              if (node.type === CHARACTER_REFERENCE_NODE_TYPE) {
                setSelectedCharacterId(node.data.characterId);
                setSelectedNodeId(null);
              } else {
                setSelectedNodeId(node.id);
                setSelectedCharacterId(null);
              }

              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
              setSelectedCharacterId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedCharacterId(null);
              setSelectedEdgeId(null);
            }}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            minZoom={0.35}
            deleteKeyCode={["Backspace", "Delete"]}
            selectionOnDrag
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="rgba(121, 86, 54, 0.14)" />
            <MiniMap
              pannable
              zoomable
              style={{
                backgroundColor: "rgba(255, 250, 244, 0.92)",
                border: "1px solid rgba(88, 61, 35, 0.12)",
              }}
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>

        <aside className={`${styles.panel} ${styles.details}`}>
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
                    <label className={styles.label}>Provider</label>
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
                      <option value="auto">按项目优先级</option>
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
                  <label className={styles.label}>人物设定</label>
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
                  <label className={styles.label}>生成补充</label>
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

                <div className={styles.metaList}>
                  <div className={styles.metaRow}>
                    <span>角色卡位置</span>
                    <code>
                      {Math.round(selectedCharacter.canvasPosition.x)},{" "}
                      {Math.round(selectedCharacter.canvasPosition.y)}
                    </code>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => handleDeleteCharacter(selectedCharacter.id)}
                >
                  删除当前角色
                </button>
              </>
            ) : selectedEdge ? (
              <>
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
                  选中剧情节点后可以编辑动作和生成参数；选中角色卡后可以编辑角色参考图和人物设定；选中过渡后可以编辑条件变量。
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>

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
                <h2 className={styles.modalTitle}>国产视频模型配置</h2>
                <p className={styles.hint}>
                  这里集中配置字节 / Doubao、MiniMax、Vidu、Kling。只在当前浏览器本地保存，不会写进工程 JSON。
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
                当前节点若选择“按项目优先级”，会从上面顺序里挑选已配置的 provider。
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
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
