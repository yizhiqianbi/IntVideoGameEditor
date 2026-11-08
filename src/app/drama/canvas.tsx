"use client";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { Shot } from "@/lib/drama";
import type { AssetCard } from "@/lib/drama-assets";
import { shotEdges, validateShotLink, walkShotTree } from "@/lib/drama-tree";
import styles from "./studio.module.css";
import type { CanvasContext } from "./context-menu";

const EDGE_STYLE = { stroke: "#6a4548", strokeWidth: 2 };
const STATUS_LABELS: Record<string, string> = {
  IN_QUEUE: "排队中",
  IN_PROGRESS: "生成中",
  COMPLETED: "已完成",
  FAILED: "失败",
  CHECK_FAILED: "查询暂停",
  SUBMITTING: "提交中",
};

type FlowNode = Node<{
  shot?: Shot;
  index?: number;
  asset?: AssetCard;
  imageBusy?: boolean;
  imageLocked?: boolean;
  dropImages?: (files: File[]) => void;
  generateImage?: () => void;
}>;

export type PositionUpdate = {
  id: string;
  position: { x: number; y: number };
};

export function GenerationStatus({ shot: s }: { shot: Shot }) {
  const [now, setNow] = useState(() => Date.now());
  const active = ["SUBMITTING", "IN_QUEUE", "IN_PROGRESS"].includes(
    s.status || "",
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!s.status) return null;
  const seconds = s.generationStartedAt
    ? Math.max(
        0,
        Math.floor(
          ((s.generationFinishedAt ||
            (active ? now : s.statusUpdatedAt) ||
            now) -
            s.generationStartedAt) /
            1000,
        ),
      )
    : undefined;
  const stage =
    s.status === "COMPLETED"
      ? 3
      : s.status === "IN_PROGRESS"
        ? 2
        : s.status === "IN_QUEUE"
          ? 1
          : 0;
  return (
    <div className={styles.generationStatus}>
      <div className={styles.generationHeading}>
        <strong>
          {STATUS_LABELS[s.status] || s.status}
          {s.status === "IN_QUEUE" && s.queuePosition
            ? ` · 队列第 ${s.queuePosition} 位`
            : ""}
        </strong>
        {seconds !== undefined && (
          <span>
            {s.generationFinishedAt ? "用时" : "已等待"} {Math.floor(seconds / 60)}
            分{seconds % 60}秒
          </span>
        )}
      </div>
      <div className={styles.generationSteps} aria-label="生成阶段">
        {["提交", "排队", "生成", "完成"].map((label, index) => (
          <span key={label} data-reached={index <= stage}>
            {label}
          </span>
        ))}
      </div>
      {active && (
        <div className={styles.generationActivity} aria-label="任务处理中">
          <span />
        </div>
      )}
      {s.status === "IN_PROGRESS" && (
        <small>
          模型加载、推理及视频编码中，后端暂不提供精确百分比。
        </small>
      )}
      {s.status === "CHECK_FAILED" && (
        <small>
          状态查询已暂停，任务可能仍在后台运行；在右侧继续查询。
        </small>
      )}
      {s.error && (
        <div className={styles.generationError}>{s.error}</div>
      )}
      {s.statusUpdatedAt && (
        <small>
          状态更新于{" "}
          {new Date(s.statusUpdatedAt).toLocaleTimeString("zh-CN")}
          {active ? " · 每 6 秒查询" : ""}
        </small>
      )}
    </div>
  );
}

const ShotNode = memo(
  function ShotNode({ data, selected }: NodeProps<FlowNode>) {
    const s = data.shot as Shot;
    const preview =
      s.promptFields?.action ||
      s.prompt ||
      "点击镜头，在右侧写画面 Prompt。";
    return (
      <article className={`${styles.node} ${selected ? styles.selected : ""}`}>
        <Handle type="target" position={Position.Left} />
        <div className={styles.nodeHead}>
          <span>SHOT {String(Number(data.index) + 1).padStart(2, "0")}</span>
          <span>
            {s.mode.toUpperCase()} · {s.duration || 15}s
            {s.positionLocked && <em className={styles.positionBadge}> · 锁定</em>}
            {s.timelineDirector?.enabled ? (
              <em className={styles.directorBadge}>导演</em>
            ) : null}
          </span>
        </div>
        <div className={styles.frame}>
          {s.videoUrl ? (
            <video
              className="nodrag"
              src={s.videoUrl}
              controls
              preload="none"
            />
          ) : (
            <>
              <span className={styles.frameNumber}>
                {String(Number(data.index) + 1).padStart(2, "0")}
              </span>
              <span>
                {STATUS_LABELS[s.status || ""] || "等待生成画面"}
              </span>
            </>
          )}
        </div>
        <h3>{s.title}</h3>
        <GenerationStatus shot={s} />
        <p>{preview}</p>
        <Handle type="source" position={Position.Right} />
      </article>
    );
  },
  (prev, next) =>
    prev.selected === next.selected &&
    prev.data.index === next.data.index &&
    prev.data.shot === next.data.shot,
);

const AssetNode = memo(
  function AssetNode({ data, selected }: NodeProps<FlowNode>) {
    const a = data.asset as AssetCard;
    return (
      <article
        className={`${styles.node} ${styles.assetNode} ${selected ? styles.selected : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            e.stopPropagation();
            data.dropImages?.(Array.from(e.dataTransfer.files));
          }
        }}
      >
        <div className={styles.nodeHead}>
          <span>
            {a.kind === "scene" ? "SCENE / 场景卡" : "REFERENCE / 参考卡"}
          </span>
          <span>{a.positionLocked ? "锁定" : "↗"}</span>
        </div>
        <div
          className={`${styles.assetFrame} ${a.imageUrl ? "" : styles.assetFrameEmpty}`}
        >
          {a.imageUrl ? (
            <img
              src={a.imageUrl}
              alt={a.title}
              draggable={false}
              onError={(e) => {
                e.currentTarget.style.opacity = "0.2";
              }}
              onLoad={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            />
          ) : (
            <span>
              {a.kind === "scene" ? "⌂" : "◎"}
              <small>拖入图片或添加文字设定</small>
            </span>
          )}
        </div>
        <h3>{a.title}</h3>
        <p>{a.description || "选择卡片，编辑设定并勾选关联镜头。"}</p>
        <button
          className="nodrag nopan"
          disabled={Boolean(data.imageLocked)}
          onClick={(event) => {
            event.stopPropagation();
            data.generateImage?.();
          }}
        >
          {data.imageBusy
            ? "生图中 · 再点一张"
            : a.imageUrl
              ? "重新生图 · 1K"
              : "生图 · 1K"}
        </button>
      </article>
    );
  },
  (prev, next) =>
    prev.selected === next.selected &&
    prev.data.asset === next.data.asset &&
    prev.data.imageBusy === next.data.imageBusy &&
    prev.data.imageLocked === next.data.imageLocked,
);

const nodeTypes = { shot: ShotNode, asset: AssetNode };

function selectedLookup(selected: string, selection: string[]) {
  return new Set(selection.length ? selection : selected ? [selected] : []);
}

function buildNodes(input: {
  shots: Shot[];
  assets: AssetCard[];
  selected: string;
  selection: string[];
  imageBusyIds: string[];
  imageLocked: boolean;
  dropImages: (id: string, files: File[]) => void;
  generateImage: (id: string) => void;
}): FlowNode[] {
  const active = selectedLookup(input.selected, input.selection);
  const treeOrder = walkShotTree(input.shots);
  const indexById = new Map(treeOrder.map((shot, index) => [shot.id, index]));
  return [
    ...input.assets.map((a) => ({
      id: a.id,
      type: "asset" as const,
      position: a.position,
      draggable: !a.positionLocked,
      connectable: false,
      selected: active.has(a.id),
      data: {
        asset: a,
        imageBusy: input.imageBusyIds.includes(a.id),
        imageLocked: input.imageLocked,
        dropImages: (files: File[]) => input.dropImages(a.id, files),
        generateImage: () => input.generateImage(a.id),
      },
    })),
    ...input.shots.map((s) => ({
      id: s.id,
      type: "shot" as const,
      position: s.position,
      draggable: !s.positionLocked,
      selected: active.has(s.id),
      data: {
        shot: s,
        index: indexById.get(s.id) ?? 0,
      },
    })),
  ];
}

function mergeNodes(prev: FlowNode[], next: FlowNode[], dragging: Set<string>) {
  const prevById = new Map(prev.map((node) => [node.id, node]));
  return next.map((node) => {
    const old = prevById.get(node.id);
    if (!old) return node;
    return {
      ...node,
      width: old.width,
      height: old.height,
      dragging: old.dragging,
      position: dragging.has(node.id) ? old.position : node.position,
    };
  });
}

export function DramaCanvas(props: {
  shots: Shot[];
  assets: AssetCard[];
  selected: string;
  selection: string[];
  imageBusyIds: string[];
  imageLocked: boolean;
  editLocked: boolean;
  gridVisible: boolean;
  snapToGrid: boolean;
  onContextMenu: (context: CanvasContext) => void;
  onInspect: (id: string) => void;
  onInit: (instance: ReactFlowInstance) => void;
  onZoom: (zoom: number) => void;
  onSelect: (id: string, additive: boolean) => void;
  onPaneClick: () => void;
  onSelectionChange: (ids: string[]) => void;
  onConnect: (connection: Connection) => void;
  onUnlink: (childId: string) => void;
  onDragBegin: () => void;
  onCommitPositions: (updates: PositionUpdate[]) => void;
  onDropImages: (id: string, files: File[]) => void;
  onGenerateImage: (id: string) => void;
}) {
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const pointerSelection = useRef<string[]>([]);
  const dragging = useRef(new Set<string>());
  const dragSession = useRef(false);
  const dropRef = useRef(props.onDropImages);
  const generateRef = useRef(props.onGenerateImage);
  const onSelectionChange = props.onSelectionChange;
  const onDragBegin = props.onDragBegin;
  const onCommitPositions = props.onCommitPositions;
  dropRef.current = props.onDropImages;
  generateRef.current = props.onGenerateImage;

  const nextNodes = useMemo(
    () =>
      buildNodes({
        shots: props.shots,
        assets: props.assets,
        selected: props.selected,
        selection: props.selection,
        imageBusyIds: props.imageBusyIds,
        imageLocked: props.imageLocked,
        dropImages: (id, files) => dropRef.current(id, files),
        generateImage: (id) => generateRef.current(id),
      }),
    [
      props.shots,
      props.assets,
      props.selected,
      props.selection,
      props.imageBusyIds,
      props.imageLocked,
    ],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(nextNodes);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    setNodes((prev) => mergeNodes(prev, nextNodes, dragging.current));
  }, [nextNodes]);

  const edges = useMemo(
    () =>
      shotEdges(props.shots).map((edge) => ({
        ...edge,
        style: EDGE_STYLE,
        type: "smoothstep" as const,
      })),
    [props.shots],
  );

  // Pointer move events can fire far more often than the screen can paint
  // (high-polling-rate trackpads/mice easily exceed 120Hz). Applying a
  // React state update per event does a lot of work that never reaches the
  // screen and competes with the browser for main-thread time, which is
  // what shows up as "laggy" dragging. Coalesce changes into at most one
  // React commit per animation frame instead.
  const pendingChanges = useRef<NodeChange<FlowNode>[]>([]);
  const flushHandle = useRef<number | null>(null);

  const flushChanges = useCallback(() => {
    flushHandle.current = null;
    const changes = pendingChanges.current;
    if (!changes.length) return;
    pendingChanges.current = [];
    const next = applyNodeChanges(changes, nodesRef.current);
    nodesRef.current = next;
    setNodes(next);
    const updates = changes.filter((change) => change.type === "select");
    if (!updates.length) return;
    onSelectionChange(next.filter(n => n.selected).map(n => n.id));
  }, [onSelectionChange]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      pendingChanges.current.push(...changes);
      if (flushHandle.current == null) {
        flushHandle.current = requestAnimationFrame(flushChanges);
      }
    },
    [flushChanges],
  );

  useEffect(() => {
    return () => {
      if (flushHandle.current != null) cancelAnimationFrame(flushHandle.current);
    };
  }, []);

  const isValidConnection = useCallback(
    (connection: { source: string | null; target: string | null }) =>
      Boolean(
        connection.source &&
          connection.target &&
          !validateShotLink(
            props.shots,
            connection.source,
            connection.target,
          ),
      ),
    [props.shots],
  );

  return (
    <ReactFlow
      aria-label="分镜画布"
      onPointerDownCapture={event => {
        if ((event.target as HTMLElement).closest(".react-flow__node")) {
          pointerSelection.current = [...selectedLookup(props.selected, props.selection)];
        }
      }}
      onKeyDownCapture={event => {
        if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        const focusedNode = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
        const direction: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (focusedNode && direction[event.key]) {
          event.preventDefault(); event.stopPropagation();
          if (props.editLocked) return;
          const [dx, dy] = direction[event.key];
          const active = selectedLookup(props.selected, props.selection);
          const updates = [...props.shots, ...props.assets].filter(c => active.has(c.id) && !c.positionLocked).map(c => ({ id: c.id, position: { x: c.position.x + dx * (event.shiftKey ? 10 : 1), y: c.position.y + dy * (event.shiftKey ? 10 : 1) } }));
          if (updates.length) { props.onDragBegin(); props.onCommitPositions(updates); }
          return;
        }
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const target = focusedNode;
        const bounds = (target ?? event.currentTarget).getBoundingClientRect();
        const screen = { x: bounds.left + Math.min(120, bounds.width / 2), y: bounds.top + Math.min(70, bounds.height / 2) };
        props.onContextMenu({ kind: target ? "node" : "pane", id: target?.dataset.id, screen, flow: instanceRef.current?.screenToFlowPosition(screen) ?? screen });
      }}
      onInit={(instance) => {
        instanceRef.current = instance as unknown as ReactFlowInstance;
        props.onInit(instance as unknown as ReactFlowInstance);
        props.onZoom(instance.getZoom());
      }}
      onMoveEnd={(_, viewport) => props.onZoom(viewport.zoom)}
      nodeTypes={nodeTypes}
      colorMode="dark"
      nodes={nodes}
      edges={edges}
      nodesDraggable={!props.editLocked}
      multiSelectionKeyCode={["Shift", "Meta", "Control"]}
      nodesConnectable={!props.editLocked}
      snapToGrid={props.snapToGrid}
      snapGrid={[22, 22]}
      onlyRenderVisibleElements
      elevateNodesOnSelect={false}
      connectionMode={ConnectionMode.Strict}
      connectionLineType={ConnectionLineType.SmoothStep}
      isValidConnection={isValidConnection}
      onConnect={props.onConnect}
      onEdgeDoubleClick={(_, edge) => props.onUnlink(edge.target)}
      onPaneContextMenu={event => {
        event.preventDefault();
        const screen = { x: event.clientX, y: event.clientY };
        props.onContextMenu({ kind: "pane", screen, flow: instanceRef.current?.screenToFlowPosition(screen) ?? screen });
      }}
      onNodeContextMenu={(event, node) => {
        event.preventDefault();
        event.stopPropagation();
        const screen = { x: event.clientX, y: event.clientY };
        props.onContextMenu({ kind: "node", id: node.id, screen, flow: instanceRef.current?.screenToFlowPosition(screen) ?? screen });
      }}
      onEdgeContextMenu={(event, edge) => {
        event.preventDefault();
        event.stopPropagation();
        const screen = { x: event.clientX, y: event.clientY };
        props.onContextMenu({ kind: "edge", id: edge.id, source: edge.source, target: edge.target, screen, flow: instanceRef.current?.screenToFlowPosition(screen) ?? screen });
      }}
      onNodeDoubleClick={(_, node) => props.onInspect(node.id)}
      onNodeClick={(e, n) => {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const before = pointerSelection.current;
        const ids = additive ? before.includes(n.id) ? before.filter(id => id !== n.id) : [...before, n.id] : [n.id];
        // Pointer selection is authoritative here; discard delayed native
        // selection changes so they cannot undo modifier-click selection.
        pendingChanges.current = pendingChanges.current.filter(c => c.type !== "select");
        props.onSelect(n.id, additive);
        props.onSelectionChange(ids);
      }}
      onPaneClick={props.onPaneClick}
      onNodesChange={onNodesChange}
      onNodeDragStart={(_, node) => {
        if (!dragSession.current) {
          dragSession.current = true;
          onDragBegin();
        }
        dragging.current.add(node.id);
      }}
      onNodeDrag={(_, node) => {
        dragging.current.add(node.id);
      }}
      onNodeDragStop={(_, node, dragged) => {
        const moving = dragged.length ? dragged : [node];
        const updates = moving.map((item) => ({
          id: item.id,
          position: item.position,
        }));
        dragging.current.clear();
        dragSession.current = false;
        onCommitPositions(updates);
      }}
      deleteKeyCode={null}
      minZoom={0.2}
      maxZoom={1.5}
      defaultViewport={{ x: 280, y: 150, zoom: 0.65 }}
    >
      {props.gridVisible && <Background color="#3a2c30" gap={22} />}
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
