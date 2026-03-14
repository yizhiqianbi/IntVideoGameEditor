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
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
        font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
      }
      .player {
        position: relative;
        width: 100vw;
        height: 100vh;
        background: #000;
      }
      video, .slide {
        width: 100%;
        height: 100%;
        display: block;
        background: #000;
      }
      video {
        object-fit: contain;
      }
      .slide {
        display: grid;
        place-items: center;
        padding: 40px;
        color: rgba(255, 248, 240, 0.94);
        text-align: center;
      }
      .slideInner {
        display: grid;
        gap: 12px;
        max-width: 680px;
      }
      .slideTitle {
        font-size: clamp(26px, 3vw, 42px);
        font-weight: 700;
        line-height: 1.2;
      }
      .slideBody {
        font-size: 16px;
        line-height: 1.65;
        color: rgba(255, 248, 240, 0.78);
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 32px;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.74));
      }
      .overlay[hidden] {
        display: none;
      }
      .overlayInner {
        display: grid;
        gap: 14px;
        width: min(560px, 100%);
        justify-items: center;
        text-align: center;
      }
      .overlayTitle {
        color: #fff8f0;
        font-size: clamp(24px, 2.6vw, 38px);
        font-weight: 700;
        line-height: 1.2;
      }
      .overlayBody {
        color: rgba(255, 248, 240, 0.82);
        font-size: 15px;
        line-height: 1.6;
      }
      .buttonGroup {
        display: grid;
        gap: 12px;
        width: min(420px, 100%);
      }
      .choiceButton {
        min-height: 52px;
        border: 0;
        border-radius: 999px;
        padding: 0 18px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        background: rgba(255, 248, 240, 0.92);
        color: #241710;
      }
      .choiceButton.primary {
        background: linear-gradient(135deg, #d76c43, #bf4d29);
        color: #fff8f0;
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
          <div id="overlayBody" class="overlayBody">点击开始。</div>
          <div id="buttonGroup" class="buttonGroup"></div>
        </div>
      </div>
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

  return {
    fileName: "interactive-branching-export.html",
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
    const fileName = `branch-path-${String(index + 1).padStart(2, "0")}-${sanitizeFileNamePart(
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
