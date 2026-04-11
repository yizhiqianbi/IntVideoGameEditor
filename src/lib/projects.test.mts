import test from "node:test";
import assert from "node:assert/strict";

import projectsModule from "./projects";
import projectModule from "../components/editor/project";

const {
  buildProjectPackageManifest,
  calculateProjectStats,
  resolveProjectSnapshotForEditing,
} = projectsModule as typeof import("./projects");
const {
  buildTransitionEdge,
  createCharacterDefinition,
  createSceneDefinition,
  createVideoSceneNode,
  serializeProject,
} = projectModule as typeof import("../components/editor/project");

type ProjectPackageAssetEntry = import("./projects").ProjectPackageAssetEntry;
type ProjectRecord = import("./projects").ProjectRecord;
type RecoveryDraftRecord = import("./projects").RecoveryDraftRecord;

function createSampleProject() {
  const node1 = createVideoSceneNode({ x: 80, y: 80 }, { title: "开场" });
  const node2 = createVideoSceneNode({ x: 80, y: 320 }, { title: "分支 1" });
  const node3 = createVideoSceneNode({ x: 320, y: 320 }, { title: "分支 2" });
  const edges = [
    buildTransitionEdge({
      source: node1.id,
      target: node2.id,
      conditionVariable: "go_left",
      choiceLabel: "向左",
    }),
    buildTransitionEdge({
      source: node1.id,
      target: node3.id,
      conditionVariable: "go_right",
      choiceLabel: "向右",
    }),
  ];

  return serializeProject(
    [node1, node2, node3],
    edges,
    [createCharacterDefinition(1, { name: "林澈" })],
    [createSceneDefinition(1, { name: "旧港口" })],
    {
      providerPriority: ["doubao", "minimax", "vidu", "kling"],
    },
  );
}

test("calculateProjectStats reports nodes, scenes, characters, and branch points", () => {
  const project = createSampleProject();

  assert.deepEqual(calculateProjectStats(project), {
    characterCount: 1,
    sceneCount: 1,
    nodeCount: 3,
    branchCount: 1,
  });
});

test("resolveProjectSnapshotForEditing prefers a newer recovery draft", () => {
  const project = createSampleProject();
  const projectRecord = {
    id: "project-1",
    name: "雾港回声",
    description: "",
    createdAt: "2026-04-11T08:00:00.000Z",
    updatedAt: "2026-04-11T08:00:00.000Z",
    lastOpenedAt: "2026-04-11T08:00:00.000Z",
    previewImageUrl: undefined,
    snapshot: project,
    referencedAssetIds: [],
    stats: calculateProjectStats(project),
  } satisfies ProjectRecord;
  const recoveryDraft = {
    projectId: "project-1",
    updatedAt: "2026-04-11T09:30:00.000Z",
    snapshot: {
      ...project,
      nodes: project.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              data: {
                ...node.data,
                title: "恢复后的开场",
              },
            }
          : node,
      ),
    },
  } satisfies RecoveryDraftRecord;

  const resolved = resolveProjectSnapshotForEditing(projectRecord, recoveryDraft);

  assert.equal(resolved.source, "recovery");
  assert.equal(resolved.snapshot.nodes[0]?.data.title, "恢复后的开场");
});

test("buildProjectPackageManifest emits expected directory layout", () => {
  const assets = [
    {
      assetId: "image-1",
      kind: "image",
      fileName: "hero.png",
      mimeType: "image/png",
      path: "media/images/hero.png",
    },
    {
      assetId: "video-1",
      kind: "video",
      fileName: "scene.mp4",
      mimeType: "video/mp4",
      path: "media/videos/scene.mp4",
    },
  ] satisfies ProjectPackageAssetEntry[];

  const manifest = buildProjectPackageManifest({
    projectId: "project-1",
    projectName: "雾港回声",
    exportedAt: "2026-04-11T09:00:00.000Z",
    assets,
  });

  assert.equal(manifest.projectPath, "project.json");
  assert.deepEqual(manifest.directories, [
    "media/",
    "media/images/",
    "media/videos/",
    "exports/",
  ]);
  assert.equal(manifest.assets[0]?.path, "media/images/hero.png");
  assert.equal(manifest.assets[1]?.path, "media/videos/scene.mp4");
});
