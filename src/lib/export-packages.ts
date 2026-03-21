import type {
  CharacterDefinition,
  EditorFlowEdge,
  EditorFlowNode,
} from "../components/editor/project";

type ExportChoice = {
  label: string;
  conditionVariable: string;
  targetId: string;
};

type ExportScene = {
  id: string;
  title: string;
  shotNotes: string;
  videoUrl?: string;
  coverUrl?: string;
  missingReason?: string;
  choices: ExportChoice[];
};

type ExportPath = {
  id: string;
  title: string;
  choiceTrail: string[];
  scenes: ExportScene[];
};

type ExportGraph = {
  title: string;
  rootSceneId: string | null;
  sceneCount: number;
  playableSceneCount: number;
  missingVideoCount: number;
  scenes: ExportScene[];
  paths: ExportPath[];
  characters: Array<Pick<CharacterDefinition, "id" | "name">>;
};

export type ExportBundle = {
  fileName: string;
  content: string;
  missingVideoCount: number;
  playableSceneCount: number;
  sceneCount: number;
};

function sortNodes(nodes: EditorFlowNode[]) {
  return [...nodes].sort((left, right) => {
    if (left.position.y !== right.position.y) {
      return left.position.y - right.position.y;
    }

    return left.position.x - right.position.x;
  });
}

function sortEdges(edges: EditorFlowEdge[], nodesById: Map<string, EditorFlowNode>) {
  return [...edges].sort((left, right) => {
    const leftTarget = nodesById.get(left.target);
    const rightTarget = nodesById.get(right.target);

    if (leftTarget && rightTarget && leftTarget.position.x !== rightTarget.position.x) {
      return leftTarget.position.x - rightTarget.position.x;
    }

    if (leftTarget && rightTarget && leftTarget.position.y !== rightTarget.position.y) {
      return leftTarget.position.y - rightTarget.position.y;
    }

    return String(left.data?.choiceLabel ?? "").localeCompare(
      String(right.data?.choiceLabel ?? ""),
      "zh-Hans-CN",
    );
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeForHtml(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function sanitizeFileNamePart(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\-+|\-+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
}

function buildExportGraph(
  nodes: EditorFlowNode[],
  edges: EditorFlowEdge[],
  characters: CharacterDefinition[],
): ExportGraph {
  const sortedNodes = sortNodes(nodes);

  if (sortedNodes.length === 0) {
    throw new Error("当前没有可导出的剧情节点。");
  }

  const nodesById = new Map(sortedNodes.map((node) => [node.id, node]));
  const validEdges = sortEdges(
    edges.filter(
      (edge) => nodesById.has(edge.source) && nodesById.has(edge.target),
    ),
    nodesById,
  );
  const incomingNodeIds = new Set(validEdges.map((edge) => edge.target));
  const roots = sortedNodes.filter((node) => !incomingNodeIds.has(node.id));
  const rootSceneId = roots[0]?.id ?? sortedNodes[0]?.id ?? null;
  const outgoingBySource = new Map<string, EditorFlowEdge[]>();

  for (const edge of validEdges) {
    const currentEdges = outgoingBySource.get(edge.source) ?? [];
    currentEdges.push(edge);
    outgoingBySource.set(edge.source, currentEdges);
  }

  const scenes = sortedNodes.map<ExportScene>((node) => ({
    id: node.id,
    title: node.data.title || "未命名片段",
    shotNotes: node.data.shotNotes,
    videoUrl: node.data.generatedVideoUrl,
    coverUrl: node.data.generatedCoverUrl,
    missingReason: node.data.generatedVideoUrl
      ? undefined
      : node.data.generationTask?.status === "failed"
        ? node.data.generationTask.errorMessage || "生成失败"
        : "当前片段没有可导出的生成视频。",
    choices: (outgoingBySource.get(node.id) ?? []).map((edge) => ({
      label: edge.data?.choiceLabel?.trim() || "继续",
      conditionVariable: edge.data?.conditionVariable?.trim() || "continue",
      targetId: edge.target,
    })),
  }));
  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const playableSceneCount = scenes.filter((scene) => Boolean(scene.videoUrl)).length;
  const missingVideoCount = scenes.length - playableSceneCount;
  const paths: ExportPath[] = [];

  function walkPath(sceneId: string, trail: string[], choiceTrail: string[]) {
    const scene = sceneMap.get(sceneId);

    if (!scene) {
      return;
    }

    const nextTrail = [...trail, sceneId];

    if (scene.choices.length === 0) {
      const title =
        choiceTrail.filter((item) => item.trim().length > 0 && item !== "继续").join(" / ") ||
        (paths.length === 0 ? "主线" : `路径 ${paths.length + 1}`);

      paths.push({
        id: `path-${paths.length + 1}`,
        title,
        choiceTrail: [...choiceTrail],
        scenes: nextTrail
          .map((nodeId) => sceneMap.get(nodeId))
          .filter((item): item is ExportScene => Boolean(item)),
      });
      return;
    }

    for (const choice of scene.choices) {
      walkPath(choice.targetId, nextTrail, [...choiceTrail, choice.label]);
    }
  }

  if (rootSceneId) {
    walkPath(rootSceneId, [], []);
  }

  if (paths.length === 0 && rootSceneId && sceneMap.has(rootSceneId)) {
    paths.push({
      id: "path-1",
      title: "主线",
      choiceTrail: [],
      scenes: [sceneMap.get(rootSceneId)!],
    });
  }

  return {
    title: sceneMap.get(rootSceneId ?? "")?.title || sortedNodes[0]?.data.title || "互动短剧",
    rootSceneId,
    sceneCount: scenes.length,
    playableSceneCount,
    missingVideoCount,
    scenes,
    paths,
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
  };
}

function buildBaseHtml({
  title,
  payload,
  script,
}: {
  title: string;
  payload: unknown;
  script: string;
}) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body {
        width: 100%; height: 100%; overflow: hidden;
        background: #0a0a0f;
        font-family: -apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Noto Sans SC", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .player {
        position: relative;
        width: 100vw; height: 100vh;
        background:
          radial-gradient(ellipse 60% 50% at 20% 20%, rgba(124, 77, 255, 0.06), transparent),
          radial-gradient(ellipse 50% 40% at 80% 80%, rgba(9, 196, 217, 0.04), transparent),
          #0a0a0f;
      }
      video, .slide {
        width: 100%; height: 100%;
        display: block; background: transparent;
      }
      video {
        object-fit: contain;
        border-radius: 0;
      }
      video::-webkit-media-controls-panel {
        background: linear-gradient(0deg, rgba(0,0,0,0.7), transparent);
      }

      /* Slide (placeholder when no video) */
      .slide {
        display: grid; place-items: center;
        padding: 48px;
        color: rgba(228, 228, 236, 0.94);
        text-align: center;
        background:
          radial-gradient(ellipse 40% 35% at 50% 40%, rgba(124, 77, 255, 0.08), transparent),
          transparent;
      }
      .slideInner { display: grid; gap: 14px; max-width: 640px; }
      .slideTitle {
        font-size: clamp(28px, 3.5vw, 48px);
        font-weight: 700; line-height: 1.15;
        background: linear-gradient(135deg, #e4e4ec, #a8b4c8);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .slideBody {
        font-size: 16px; line-height: 1.7;
        color: rgba(228, 228, 236, 0.6);
      }

      /* Overlay (choices, start screen, end screen) */
      .overlay {
        position: absolute; inset: 0;
        display: grid; place-items: center;
        padding: 32px;
        background: rgba(10, 10, 15, 0.8);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        animation: overlayIn 300ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes overlayIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .overlay[hidden] { display: none; }
      .overlayInner {
        display: grid; gap: 20px;
        width: min(480px, 100%);
        justify-items: center; text-align: center;
      }
      .overlayTitle {
        font-size: clamp(26px, 3vw, 42px);
        font-weight: 700; line-height: 1.15;
        background: linear-gradient(135deg, #fff, #c8d0e0);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .overlayBody {
        color: rgba(228, 228, 236, 0.65);
        font-size: 15px; line-height: 1.65;
      }

      /* Button group */
      .buttonGroup {
        display: grid; gap: 10px;
        width: min(380px, 100%);
        margin-top: 4px;
      }
      .choiceButton {
        position: relative;
        min-height: 52px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 14px 22px;
        font-size: 15px; font-weight: 600;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(228, 228, 236, 0.9);
        backdrop-filter: blur(8px);
        transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
                    border-color 180ms ease,
                    box-shadow 180ms ease,
                    background 180ms ease;
      }
      .choiceButton:hover {
        transform: translateY(-2px);
        border-color: rgba(9, 196, 217, 0.3);
        background: rgba(9, 196, 217, 0.08);
        box-shadow: 0 4px 20px rgba(9, 196, 217, 0.12);
      }
      .choiceButton:active {
        transform: translateY(0);
      }
      .choiceButton.primary {
        border: none;
        background: linear-gradient(135deg, #6b3cff 0%, #7c4dff 40%, #09c4d9 100%);
        color: #fff;
        box-shadow: 0 8px 28px rgba(124, 77, 255, 0.3), 0 0 0 1px rgba(124, 77, 255, 0.15);
      }
      .choiceButton.primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 36px rgba(124, 77, 255, 0.4), 0 0 0 1px rgba(124, 77, 255, 0.25);
      }

      /* Branding watermark */
      .watermark {
        position: absolute; bottom: 16px; left: 50%;
        transform: translateX(-50%);
        font-size: 11px; letter-spacing: 0.08em;
        color: rgba(228, 228, 236, 0.18);
        pointer-events: none; z-index: 1;
      }

      /* Progress indicator */
      .sceneIndicator {
        position: absolute; top: 16px; right: 20px;
        padding: 6px 14px;
        border-radius: 999px;
        background: rgba(28, 28, 34, 0.7);
        backdrop-filter: blur(8px);
        color: rgba(228, 228, 236, 0.5);
        font-size: 12px; font-weight: 600;
        letter-spacing: 0.04em;
        pointer-events: none; z-index: 1;
      }
    </style>
  </head>
  <body>
    <main class="player">
      <video id="video" playsinline preload="auto" controls hidden></video>
      <div id="slide" class="slide">
        <div class="slideInner">
          <div class="slideTitle">准备播放</div>
          <div class="slideBody">点击开始后进入播放。</div>
        </div>
      </div>
      <div id="overlay" class="overlay">
        <div class="overlayInner">
          <div id="overlayTitle" class="overlayTitle">开始播放</div>
          <div id="overlayBody" class="overlayBody"></div>
          <div id="buttonGroup" class="buttonGroup"></div>
        </div>
      </div>
      <div id="sceneIndicator" class="sceneIndicator" hidden></div>
      <div class="watermark">PencilStudio</div>
    </main>
    <script id="payload" type="application/json">${serializeForHtml(payload)}</script>
    <script>
      ${script}
    </script>
  </body>
</html>`;
}

function buildInteractiveHtml(graph: ExportGraph) {
  return buildBaseHtml({
    title: `${graph.title} - 互动版`,
    payload: {
      title: graph.title,
      rootSceneId: graph.rootSceneId,
      scenes: graph.scenes,
    },
    script: `
      const payload = JSON.parse(document.getElementById("payload").textContent);
      const sceneMap = new Map(payload.scenes.map((scene) => [scene.id, scene]));
      const video = document.getElementById("video");
      const slide = document.getElementById("slide");
      const overlay = document.getElementById("overlay");
      const overlayTitle = document.getElementById("overlayTitle");
      const overlayBody = document.getElementById("overlayBody");
      const buttonGroup = document.getElementById("buttonGroup");
      let currentSceneId = payload.rootSceneId;

      function setButtons(buttons) {
        buttonGroup.replaceChildren(...buttons);
      }

      function makeButton(label, onClick, primary = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = primary ? "choiceButton primary" : "choiceButton";
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
      }

      function showOverlay(title, body, buttons) {
        overlay.hidden = false;
        overlayTitle.textContent = title;
        overlayBody.textContent = body;
        setButtons(buttons);
      }

      function hideOverlay() {
        overlay.hidden = true;
      }

      function showSlide(title, body) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.hidden = true;
        slide.hidden = false;
        slide.innerHTML = '<div class="slideInner"><div class="slideTitle">' + title + '</div><div class="slideBody">' + body + "</div></div>";
      }

      function moveToScene(sceneId) {
        const scene = sceneMap.get(sceneId);

        if (!scene) {
          showOverlay("无法继续", "没有找到下一个节点。", [
            makeButton("重新开始", startStory, true),
          ]);
          return;
        }

        currentSceneId = scene.id;
        hideOverlay();

        if (!scene.videoUrl) {
          showSlide(scene.title, scene.missingReason || "当前片段没有可播放视频。");
          handleSceneEnd(scene);
          return;
        }

        slide.hidden = true;
        video.hidden = false;
        video.poster = scene.coverUrl || "";
        video.src = scene.videoUrl;
        video.load();
        const playPromise = video.play();

        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            showOverlay("继续播放", "浏览器阻止了自动播放，请点击继续。", [
              makeButton("继续", () => {
                hideOverlay();
                video.play().catch(() => undefined);
              }, true),
            ]);
          });
        }
      }

      function handleSceneEnd(scene) {
        if (scene.choices.length === 0) {
          showOverlay("播放完成", "这一条剧情已经结束。", [
            makeButton("重新开始", startStory, true),
          ]);
          return;
        }

        if (scene.choices.length === 1) {
          window.setTimeout(() => {
            moveToScene(scene.choices[0].targetId);
          }, 420);
          return;
        }

        showOverlay(
          "请选择后续剧情",
          "",
          scene.choices.map((choice) =>
            makeButton(choice.label, () => moveToScene(choice.targetId), true),
          ),
        );
      }

      function startStory() {
        if (!payload.rootSceneId || !sceneMap.has(payload.rootSceneId)) {
          showOverlay("无法开始", "导出包里没有 root 节点。", []);
          return;
        }

        moveToScene(payload.rootSceneId);
      }

      video.addEventListener("ended", () => {
        const scene = sceneMap.get(currentSceneId);
        if (scene) {
          handleSceneEnd(scene);
        }
      });

      showOverlay("开始播放", "", [
        makeButton("开始", startStory, true),
      ]);
    `,
  });
}

function buildLinearPathHtml(title: string, path: ExportPath) {
  return buildBaseHtml({
    title,
    payload: {
      title,
      pathTitle: path.title,
      scenes: path.scenes,
    },
    script: `
      const payload = JSON.parse(document.getElementById("payload").textContent);
      const video = document.getElementById("video");
      const slide = document.getElementById("slide");
      const overlay = document.getElementById("overlay");
      const overlayTitle = document.getElementById("overlayTitle");
      const overlayBody = document.getElementById("overlayBody");
      const buttonGroup = document.getElementById("buttonGroup");
      let sceneIndex = -1;

      function makeButton(label, onClick, primary = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = primary ? "choiceButton primary" : "choiceButton";
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
      }

      function showOverlay(title, body, buttons) {
        overlay.hidden = false;
        overlayTitle.textContent = title;
        overlayBody.textContent = body;
        buttonGroup.replaceChildren(...buttons);
      }

      function hideOverlay() {
        overlay.hidden = true;
      }

      function showSlide(title, body) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.hidden = true;
        slide.hidden = false;
        slide.innerHTML = '<div class="slideInner"><div class="slideTitle">' + title + '</div><div class="slideBody">' + body + "</div></div>";
      }

      function moveNext() {
        sceneIndex += 1;

        if (sceneIndex >= payload.scenes.length) {
          showOverlay("播放完成", "", [
            makeButton("重新播放", restart, true),
          ]);
          return;
        }

        const scene = payload.scenes[sceneIndex];

        if (!scene.videoUrl) {
          showSlide(scene.title, scene.missingReason || "当前片段没有可播放视频。");
          hideOverlay();
          window.setTimeout(moveNext, 1400);
          return;
        }

        slide.hidden = true;
        video.hidden = false;
        video.poster = scene.coverUrl || "";
        video.src = scene.videoUrl;
        video.load();
        const playPromise = video.play();

        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            showOverlay("继续播放", "", [
              makeButton("继续", () => {
                hideOverlay();
                video.play().catch(() => undefined);
              }, true),
            ]);
          });
        }
      }

      function restart() {
        sceneIndex = -1;
        hideOverlay();
        moveNext();
      }

      video.addEventListener("ended", moveNext);

      showOverlay("开始播放", payload.pathTitle || "", [
        makeButton("开始", restart, true),
      ]);
    `,
  });
}

export function buildInteractiveExportBundle(input: {
  nodes: EditorFlowNode[];
  edges: EditorFlowEdge[];
  characters: CharacterDefinition[];
}): ExportBundle {
  const graph = buildExportGraph(input.nodes, input.edges, input.characters);
  const fileBaseName = sanitizeFileNamePart(graph.title, "interactive-branching-export");

  return {
    fileName: `${fileBaseName}.html`,
    content: buildInteractiveHtml(graph),
    missingVideoCount: graph.missingVideoCount,
    playableSceneCount: graph.playableSceneCount,
    sceneCount: graph.sceneCount,
  };
}

export function buildTraversalExportBundles(input: {
  nodes: EditorFlowNode[];
  edges: EditorFlowEdge[];
  characters: CharacterDefinition[];
}): ExportBundle[] {
  const graph = buildExportGraph(input.nodes, input.edges, input.characters);

  if (graph.paths.length === 0) {
    throw new Error("当前没有可导出的完整路径。");
  }

  return graph.paths.map((path, index) => {
    const graphFileBase = sanitizeFileNamePart(graph.title, "interactive-story");
    const fileName = `${graphFileBase}-${String(index + 1).padStart(2, "0")}-${sanitizeFileNamePart(
      path.title,
      `path-${index + 1}`,
    )}.html`;
    const playableSceneCount = path.scenes.filter((scene) => Boolean(scene.videoUrl)).length;
    const missingVideoCount = path.scenes.length - playableSceneCount;

    return {
      fileName,
      content: buildLinearPathHtml(`${graph.title} - ${path.title}`, path),
      missingVideoCount,
      playableSceneCount,
      sceneCount: path.scenes.length,
    };
  });
}
