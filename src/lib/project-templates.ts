import type {
  AssetKind,
  AssetRef,
  CharacterDefinition,
  EditorProject,
  SceneDefinition,
} from "../components/editor/project";

const TEMPLATE_DB_NAME = "pencil-studio-project-templates";
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = "project-templates";
const TEMPLATE_MEDIA_STORE = "project-template-media";

export type ProjectTemplateStats = {
  characterCount: number;
  sceneCount: number;
  nodeCount: number;
  branchCount: number;
};

export type ProjectTemplateRecord = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  previewImageUrl?: string;
  project: EditorProject;
  referencedAssetIds: string[];
  stats: ProjectTemplateStats;
};

export type ProjectTemplateSummary = Omit<ProjectTemplateRecord, "project">;

export type TemplateMediaRecord = {
  id: string;
  templateId: string;
  assetId: string;
  kind: AssetKind;
  fileName: string;
  mimeType?: string;
  blob: Blob;
};

export type LoadedProjectTemplate = {
  record: ProjectTemplateRecord;
  media: TemplateMediaRecord[];
};

export type TemplateMediaInput = Omit<TemplateMediaRecord, "id" | "templateId">;

export type SaveProjectTemplateInput = {
  templateId?: string;
  name: string;
  description: string;
  previewImageUrl?: string;
  project: EditorProject;
  referencedAssetIds: string[];
  media: TemplateMediaInput[];
};

function ensureIndexedDbAvailable() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    throw new Error("当前浏览器不支持本地模板库。");
  }
}

function openTemplateDb() {
  ensureIndexedDbAvailable();

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(TEMPLATE_DB_NAME, TEMPLATE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(TEMPLATE_STORE)) {
        database.createObjectStore(TEMPLATE_STORE, {
          keyPath: "id",
        });
      }

      if (!database.objectStoreNames.contains(TEMPLATE_MEDIA_STORE)) {
        const mediaStore = database.createObjectStore(TEMPLATE_MEDIA_STORE, {
          keyPath: "id",
        });
        mediaStore.createIndex("templateId", "templateId", {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("打开模板库失败。"));
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
      reject(transaction.error ?? new Error("模板事务执行失败。"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("模板事务被中断。"));
  });
}

function calculateTemplateStats(project: EditorProject): ProjectTemplateStats {
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

async function replaceTemplateMedia(
  database: IDBDatabase,
  templateId: string,
  media: TemplateMediaInput[],
) {
  const transaction = database.transaction(TEMPLATE_MEDIA_STORE, "readwrite");
  const mediaStore = transaction.objectStore(TEMPLATE_MEDIA_STORE);
  const templateIndex = mediaStore.index("templateId");
  const existingRecords = await requestToPromise(
    templateIndex.getAll(IDBKeyRange.only(templateId)),
  );

  for (const record of existingRecords) {
    mediaStore.delete(record.id);
  }

  for (const mediaEntry of media) {
    mediaStore.put({
      id: crypto.randomUUID(),
      templateId,
      ...mediaEntry,
    } satisfies TemplateMediaRecord);
  }

  await transactionDone(transaction);
}

export async function listProjectTemplates(): Promise<ProjectTemplateSummary[]> {
  const database = await openTemplateDb();

  try {
    const transaction = database.transaction(TEMPLATE_STORE, "readonly");
    const templates = await requestToPromise(
      transaction.objectStore(TEMPLATE_STORE).getAll(),
    );
    await transactionDone(transaction);

    return (templates as ProjectTemplateRecord[])
      .map((record) => ({
        id: record.id,
        name: record.name,
        description: record.description,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        previewImageUrl: record.previewImageUrl,
        referencedAssetIds: record.referencedAssetIds,
        stats: record.stats,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export async function saveProjectTemplate(
  input: SaveProjectTemplateInput,
): Promise<ProjectTemplateRecord> {
  const database = await openTemplateDb();
  const now = new Date().toISOString();
  const templateId = input.templateId ?? crypto.randomUUID();
  const stats = calculateTemplateStats(input.project);

  try {
    let createdAt = now;

    if (input.templateId) {
      const existingTransaction = database.transaction(TEMPLATE_STORE, "readonly");
      const existingRecord = (await requestToPromise(
        existingTransaction.objectStore(TEMPLATE_STORE).get(input.templateId),
      )) as ProjectTemplateRecord | undefined;
      await transactionDone(existingTransaction);

      if (existingRecord?.createdAt) {
        createdAt = existingRecord.createdAt;
      }
    }

    const record: ProjectTemplateRecord = {
      id: templateId,
      name: input.name.trim(),
      description: input.description.trim(),
      createdAt,
      updatedAt: now,
      previewImageUrl: input.previewImageUrl,
      project: input.project,
      referencedAssetIds: input.referencedAssetIds,
      stats,
    };

    const templateTransaction = database.transaction(TEMPLATE_STORE, "readwrite");
    templateTransaction.objectStore(TEMPLATE_STORE).put(record);
    await transactionDone(templateTransaction);

    await replaceTemplateMedia(database, templateId, input.media);

    return record;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "UnknownError")
    ) {
      throw new Error("模板过大，浏览器本地空间不足，无法保存。");
    }

    throw error;
  } finally {
    database.close();
  }
}

export async function updateProjectTemplate(
  templateId: string,
  input: Omit<SaveProjectTemplateInput, "templateId">,
) {
  return saveProjectTemplate({
    ...input,
    templateId,
  });
}

export async function loadProjectTemplate(
  templateId: string,
): Promise<LoadedProjectTemplate> {
  const database = await openTemplateDb();

  try {
    const templateTransaction = database.transaction(TEMPLATE_STORE, "readonly");
    const record = (await requestToPromise(
      templateTransaction.objectStore(TEMPLATE_STORE).get(templateId),
    )) as ProjectTemplateRecord | undefined;
    await transactionDone(templateTransaction);

    if (!record) {
      throw new Error("没有找到对应的模板。");
    }

    const mediaTransaction = database.transaction(TEMPLATE_MEDIA_STORE, "readonly");
    const media = (await requestToPromise(
      mediaTransaction
        .objectStore(TEMPLATE_MEDIA_STORE)
        .index("templateId")
        .getAll(IDBKeyRange.only(templateId)),
    )) as TemplateMediaRecord[];
    await transactionDone(mediaTransaction);

    return {
      record,
      media,
    };
  } finally {
    database.close();
  }
}

export async function deleteProjectTemplate(templateId: string): Promise<void> {
  const database = await openTemplateDb();

  try {
    const templateTransaction = database.transaction(TEMPLATE_STORE, "readwrite");
    templateTransaction.objectStore(TEMPLATE_STORE).delete(templateId);
    await transactionDone(templateTransaction);

    const mediaTransaction = database.transaction(TEMPLATE_MEDIA_STORE, "readwrite");
    const mediaStore = mediaTransaction.objectStore(TEMPLATE_MEDIA_STORE);
    const records = (await requestToPromise(
      mediaStore.index("templateId").getAll(IDBKeyRange.only(templateId)),
    )) as TemplateMediaRecord[];

    for (const record of records) {
      mediaStore.delete(record.id);
    }

    await transactionDone(mediaTransaction);
  } finally {
    database.close();
  }
}

export function collectProjectReferencedAssetIds(project: EditorProject) {
  const referencedAssetIds = new Set<string>();

  for (const node of project.nodes) {
    if (node.data.assetRef?.assetId) {
      referencedAssetIds.add(node.data.assetRef.assetId);
    }
  }

  for (const character of project.characters) {
    collectAssetRefs(referencedAssetIds, character.referenceImageAssetRefs);
  }

  for (const scene of project.scenes) {
    collectAssetRefs(referencedAssetIds, scene.referenceImageAssetRefs);
  }

  return Array.from(referencedAssetIds);
}

function collectAssetRefs(target: Set<string>, assetRefs: AssetRef[]) {
  for (const assetRef of assetRefs) {
    if (assetRef.assetId.trim().length > 0) {
      target.add(assetRef.assetId);
    }
  }
}

export function getTemplatePreviewFallback(
  project: EditorProject,
  runtimeImages: Record<string, string>,
) {
  const rootNode = project.nodes.find((node) =>
    !project.edges.some((edge) => edge.target === node.id),
  );

  if (rootNode?.data.generatedCoverUrl) {
    return rootNode.data.generatedCoverUrl;
  }

  for (const scene of project.scenes) {
    const previewUrl = runtimeImages[scene.referenceImageAssetRefs[0]?.assetId ?? ""];

    if (previewUrl) {
      return previewUrl;
    }
  }

  for (const character of project.characters) {
    const previewUrl =
      runtimeImages[character.referenceImageAssetRefs[0]?.assetId ?? ""];

    if (previewUrl) {
      return previewUrl;
    }
  }

  return undefined;
}
