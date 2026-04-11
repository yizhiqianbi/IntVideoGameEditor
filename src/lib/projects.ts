import type {
  AssetKind,
  EditorProject,
} from "../components/editor/project";
import {
  collectProjectReferencedAssetIds,
  getTemplatePreviewFallback,
} from "./project-templates";

const PROJECT_DB_NAME = "pencil-studio-project-library";
const PROJECT_DB_VERSION = 1;
const PROJECT_STORE = "projects";
const PROJECT_MEDIA_STORE = "project-media";
const RECOVERY_STORE = "project-recovery";
const GLOBAL_ASSET_STORE = "global-assets";

export type ProjectStats = {
  characterCount: number;
  sceneCount: number;
  nodeCount: number;
  branchCount: number;
};

export type ProjectSnapshot = EditorProject;

export type ProjectRecord = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  previewImageUrl?: string;
  snapshot: ProjectSnapshot;
  referencedAssetIds: string[];
  stats: ProjectStats;
};

export type ProjectSummary = Omit<ProjectRecord, "snapshot">;

export type ProjectMediaRecord = {
  id: string;
  projectId: string;
  assetId: string;
  kind: AssetKind;
  fileName: string;
  mimeType?: string;
  blob: Blob;
};

export type ProjectMediaInput = Omit<ProjectMediaRecord, "id" | "projectId">;

export type SaveProjectInput = {
  projectId?: string;
  name: string;
  description: string;
  previewImageUrl?: string;
  snapshot: ProjectSnapshot;
  referencedAssetIds: string[];
  media: ProjectMediaInput[];
};

export type LoadedProjectRecord = {
  record: ProjectRecord;
  media: ProjectMediaRecord[];
};

export type RecoveryDraftRecord = {
  projectId: string;
  updatedAt: string;
  snapshot: ProjectSnapshot;
};

export type GlobalAssetRecord = {
  id: string;
  name: string;
  kind: AssetKind;
  fileName: string;
  mimeType?: string;
  blob: Blob;
  createdAt: string;
  updatedAt: string;
  sourceProjectId?: string;
  sourceAssetId?: string;
};

export type SaveGlobalAssetInput = Omit<
  GlobalAssetRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type ProjectPackageAssetEntry = {
  assetId: string;
  kind: AssetKind;
  fileName: string;
  mimeType?: string;
  path: string;
};

export type ProjectPackageManifest = {
  version: 1;
  projectId: string;
  projectName: string;
  exportedAt: string;
  projectPath: "project.json";
  manifestPath: "package-manifest.json";
  directories: ["media/", "media/images/", "media/videos/", "exports/"];
  assets: ProjectPackageAssetEntry[];
};

function ensureIndexedDbAvailable() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    throw new Error("当前浏览器不支持本地项目库。");
  }
}

function openProjectDb() {
  ensureIndexedDbAvailable();

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        const store = database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("lastOpenedAt", "lastOpenedAt", { unique: false });
      }

      if (!database.objectStoreNames.contains(PROJECT_MEDIA_STORE)) {
        const mediaStore = database.createObjectStore(PROJECT_MEDIA_STORE, {
          keyPath: "id",
        });
        mediaStore.createIndex("projectId", "projectId", { unique: false });
      }

      if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
        database.createObjectStore(RECOVERY_STORE, { keyPath: "projectId" });
      }

      if (!database.objectStoreNames.contains(GLOBAL_ASSET_STORE)) {
        const globalStore = database.createObjectStore(GLOBAL_ASSET_STORE, {
          keyPath: "id",
        });
        globalStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("打开项目库失败。"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 操作失败。"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("项目事务执行失败。"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("项目事务被中断。"));
  });
}

export function calculateProjectStats(project: ProjectSnapshot): ProjectStats {
  const outgoingCountBySource = new Map<string, number>();

  for (const edge of project.edges) {
    outgoingCountBySource.set(
      edge.source,
      (outgoingCountBySource.get(edge.source) ?? 0) + 1,
    );
  }

  const branchCount = Array.from(outgoingCountBySource.values()).filter(
    (count) => count > 1,
  ).length;

  return {
    characterCount: project.characters.length,
    sceneCount: project.scenes.length,
    nodeCount: project.nodes.length,
    branchCount,
  };
}

export function resolveProjectSnapshotForEditing(
  projectRecord: ProjectRecord,
  recoveryDraft?: RecoveryDraftRecord | null,
) {
  if (
    recoveryDraft &&
    recoveryDraft.projectId === projectRecord.id &&
    recoveryDraft.updatedAt.localeCompare(projectRecord.updatedAt) > 0
  ) {
    return {
      source: "recovery" as const,
      snapshot: recoveryDraft.snapshot,
      updatedAt: recoveryDraft.updatedAt,
    };
  }

  return {
    source: "project" as const,
    snapshot: projectRecord.snapshot,
    updatedAt: projectRecord.updatedAt,
  };
}

export function buildProjectPackageManifest(input: {
  projectId: string;
  projectName: string;
  exportedAt: string;
  assets: ProjectPackageAssetEntry[];
}): ProjectPackageManifest {
  return {
    version: 1,
    projectId: input.projectId,
    projectName: input.projectName,
    exportedAt: input.exportedAt,
    projectPath: "project.json",
    manifestPath: "package-manifest.json",
    directories: ["media/", "media/images/", "media/videos/", "exports/"],
    assets: input.assets,
  };
}

async function replaceProjectMedia(
  database: IDBDatabase,
  projectId: string,
  media: ProjectMediaInput[],
) {
  const transaction = database.transaction(PROJECT_MEDIA_STORE, "readwrite");
  const mediaStore = transaction.objectStore(PROJECT_MEDIA_STORE);
  const index = mediaStore.index("projectId");
  const existingRecords = await requestToPromise(
    index.getAll(IDBKeyRange.only(projectId)),
  );

  for (const record of existingRecords) {
    mediaStore.delete(record.id);
  }

  for (const mediaEntry of media) {
    mediaStore.put({
      id: crypto.randomUUID(),
      projectId,
      ...mediaEntry,
    } satisfies ProjectMediaRecord);
  }

  await transactionDone(transaction);
}

async function getProjectPreviewImage(
  snapshot: ProjectSnapshot,
  media: ProjectMediaInput[],
) {
  const runtimeImageMap: Record<string, string> = {};

  for (const mediaEntry of media) {
    if (mediaEntry.kind !== "image") {
      continue;
    }

    runtimeImageMap[mediaEntry.assetId] = await readBlobAsDataUrl(mediaEntry.blob);
  }

  return getTemplatePreviewFallback(snapshot, runtimeImageMap);
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("读取本地媒体失败。"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("读取本地媒体失败。"));
    reader.readAsDataURL(blob);
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const records = (await requestToPromise(
      transaction.objectStore(PROJECT_STORE).getAll(),
    )) as ProjectRecord[];
    await transactionDone(transaction);

    return records
      .map((record) => ({
        id: record.id,
        name: record.name,
        description: record.description,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastOpenedAt: record.lastOpenedAt,
        previewImageUrl: record.previewImageUrl,
        referencedAssetIds: record.referencedAssetIds,
        stats: record.stats,
      }))
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  } finally {
    database.close();
  }
}

export async function saveProject(
  input: SaveProjectInput,
): Promise<ProjectRecord> {
  const database = await openProjectDb();
  const now = new Date().toISOString();
  const projectId = input.projectId ?? crypto.randomUUID();
  const stats = calculateProjectStats(input.snapshot);

  try {
    let createdAt = now;
    let lastOpenedAt = now;

    if (input.projectId) {
      const existingTransaction = database.transaction(PROJECT_STORE, "readonly");
      const existingRecord = (await requestToPromise(
        existingTransaction.objectStore(PROJECT_STORE).get(input.projectId),
      )) as ProjectRecord | undefined;
      await transactionDone(existingTransaction);

      if (existingRecord?.createdAt) {
        createdAt = existingRecord.createdAt;
      }
      if (existingRecord?.lastOpenedAt) {
        lastOpenedAt = existingRecord.lastOpenedAt;
      }
    }

    const record: ProjectRecord = {
      id: projectId,
      name: input.name.trim() || "未命名项目",
      description: input.description.trim(),
      createdAt,
      updatedAt: now,
      lastOpenedAt,
      previewImageUrl:
        input.previewImageUrl ?? (await getProjectPreviewImage(input.snapshot, input.media)),
      snapshot: input.snapshot,
      referencedAssetIds: input.referencedAssetIds,
      stats,
    };

    const projectTransaction = database.transaction(PROJECT_STORE, "readwrite");
    projectTransaction.objectStore(PROJECT_STORE).put(record);
    await transactionDone(projectTransaction);
    await replaceProjectMedia(database, projectId, input.media);

    return record;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "UnknownError")
    ) {
      throw new Error("项目过大，浏览器本地空间不足，无法保存。");
    }

    throw error;
  } finally {
    database.close();
  }
}

export async function loadProject(projectId: string): Promise<LoadedProjectRecord> {
  const database = await openProjectDb();

  try {
    const projectTransaction = database.transaction(PROJECT_STORE, "readonly");
    const record = (await requestToPromise(
      projectTransaction.objectStore(PROJECT_STORE).get(projectId),
    )) as ProjectRecord | undefined;
    await transactionDone(projectTransaction);

    if (!record) {
      throw new Error("没有找到对应的项目。");
    }

    const mediaTransaction = database.transaction(PROJECT_MEDIA_STORE, "readonly");
    const media = (await requestToPromise(
      mediaTransaction
        .objectStore(PROJECT_MEDIA_STORE)
        .index("projectId")
        .getAll(IDBKeyRange.only(projectId)),
    )) as ProjectMediaRecord[];
    await transactionDone(mediaTransaction);

    return {
      record,
      media,
    };
  } finally {
    database.close();
  }
}

export async function updateProjectLastOpenedAt(projectId: string) {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    const store = transaction.objectStore(PROJECT_STORE);
    const record = (await requestToPromise(store.get(projectId))) as
      | ProjectRecord
      | undefined;

    if (!record) {
      await transactionDone(transaction);
      return null;
    }

    const nextRecord: ProjectRecord = {
      ...record,
      lastOpenedAt: new Date().toISOString(),
    };

    store.put(nextRecord);
    await transactionDone(transaction);

    return nextRecord;
  } finally {
    database.close();
  }
}

export async function renameProject(
  projectId: string,
  input: {
    name: string;
    description: string;
  },
) {
  const loadedProject = await loadProject(projectId);

  return saveProject({
    projectId,
    name: input.name,
    description: input.description,
    previewImageUrl: loadedProject.record.previewImageUrl,
    snapshot: loadedProject.record.snapshot,
    referencedAssetIds: loadedProject.record.referencedAssetIds,
    media: loadedProject.media.map((mediaEntry) => ({
      assetId: mediaEntry.assetId,
      kind: mediaEntry.kind,
      fileName: mediaEntry.fileName,
      mimeType: mediaEntry.mimeType,
      blob: mediaEntry.blob,
    })),
  });
}

export async function deleteProject(projectId: string) {
  const database = await openProjectDb();

  try {
    const projectTransaction = database.transaction(PROJECT_STORE, "readwrite");
    projectTransaction.objectStore(PROJECT_STORE).delete(projectId);
    await transactionDone(projectTransaction);

    const mediaTransaction = database.transaction(PROJECT_MEDIA_STORE, "readwrite");
    const mediaStore = mediaTransaction.objectStore(PROJECT_MEDIA_STORE);
    const records = (await requestToPromise(
      mediaStore.index("projectId").getAll(IDBKeyRange.only(projectId)),
    )) as ProjectMediaRecord[];

    for (const record of records) {
      mediaStore.delete(record.id);
    }

    await transactionDone(mediaTransaction);

    const recoveryTransaction = database.transaction(RECOVERY_STORE, "readwrite");
    recoveryTransaction.objectStore(RECOVERY_STORE).delete(projectId);
    await transactionDone(recoveryTransaction);
  } finally {
    database.close();
  }
}

export async function saveRecoveryDraft(input: RecoveryDraftRecord) {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECOVERY_STORE).put(input);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadRecoveryDraft(projectId: string) {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const record = (await requestToPromise(
      transaction.objectStore(RECOVERY_STORE).get(projectId),
    )) as RecoveryDraftRecord | undefined;
    await transactionDone(transaction);
    return record ?? null;
  } finally {
    database.close();
  }
}

export async function clearRecoveryDraft(projectId: string) {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECOVERY_STORE).delete(projectId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listGlobalAssets(): Promise<GlobalAssetRecord[]> {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(GLOBAL_ASSET_STORE, "readonly");
    const records = (await requestToPromise(
      transaction.objectStore(GLOBAL_ASSET_STORE).getAll(),
    )) as GlobalAssetRecord[];
    await transactionDone(transaction);
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export async function saveGlobalAsset(input: SaveGlobalAssetInput) {
  const database = await openProjectDb();
  const now = new Date().toISOString();

  try {
    const transaction = database.transaction(GLOBAL_ASSET_STORE, "readwrite");
    const record: GlobalAssetRecord = {
      id: crypto.randomUUID(),
      name: input.name.trim() || input.fileName,
      kind: input.kind,
      fileName: input.fileName,
      mimeType: input.mimeType,
      blob: input.blob,
      createdAt: now,
      updatedAt: now,
      sourceProjectId: input.sourceProjectId,
      sourceAssetId: input.sourceAssetId,
    };

    transaction.objectStore(GLOBAL_ASSET_STORE).put(record);
    await transactionDone(transaction);

    return record;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "UnknownError")
    ) {
      throw new Error("全局素材库空间不足，无法继续收藏。");
    }
    throw error;
  } finally {
    database.close();
  }
}

export async function deleteGlobalAsset(globalAssetId: string) {
  const database = await openProjectDb();

  try {
    const transaction = database.transaction(GLOBAL_ASSET_STORE, "readwrite");
    transaction.objectStore(GLOBAL_ASSET_STORE).delete(globalAssetId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function buildEmptyProjectSnapshot(
  fallbackSnapshot: ProjectSnapshot,
) {
  return {
    ...fallbackSnapshot,
    nodes: fallbackSnapshot.nodes,
    edges: fallbackSnapshot.edges,
    characters: fallbackSnapshot.characters,
    scenes: fallbackSnapshot.scenes,
    settings: fallbackSnapshot.settings,
  };
}

export function buildProjectSaveInput(params: {
  projectId?: string;
  name: string;
  description: string;
  snapshot: ProjectSnapshot;
  previewImageUrl?: string;
  media: ProjectMediaInput[];
}) {
  return {
    projectId: params.projectId,
    name: params.name,
    description: params.description,
    previewImageUrl: params.previewImageUrl,
    snapshot: params.snapshot,
    referencedAssetIds: collectProjectReferencedAssetIds(params.snapshot),
    media: params.media,
  } satisfies SaveProjectInput;
}
