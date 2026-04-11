import JSZip from "jszip";
import type { EditorProject } from "../components/editor/project";
import {
  buildProjectPackageManifest,
  type LoadedProjectRecord,
  type ProjectMediaInput,
  type ProjectPackageAssetEntry,
  type ProjectRecord,
} from "./projects";

type ProjectPackageProjectFile = {
  version: 1;
  project: {
    id: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    lastOpenedAt: string;
    previewImageUrl?: string;
  };
  snapshot: EditorProject;
};

export type ImportedProjectPackage = {
  name: string;
  description: string;
  previewImageUrl?: string;
  snapshot: EditorProject;
  media: ProjectMediaInput[];
};

function sanitizeFileNamePart(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\-+|\-+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
}

function buildProjectFile(record: ProjectRecord): ProjectPackageProjectFile {
  return {
    version: 1,
    project: {
      id: record.id,
      name: record.name,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastOpenedAt: record.lastOpenedAt,
      previewImageUrl: record.previewImageUrl,
    },
    snapshot: record.snapshot,
  };
}

function buildAssetPath(
  asset: LoadedProjectRecord["media"][number],
  usedPaths: Set<string>,
): ProjectPackageAssetEntry {
  const baseName = sanitizeFileNamePart(asset.fileName, asset.assetId);
  const extensionMatch = baseName.match(/(\.[a-z0-9]+)$/i);
  const extension = extensionMatch?.[1] ?? "";
  const rawStem = extension ? baseName.slice(0, -extension.length) : baseName;
  const safeStem = rawStem.length > 0 ? rawStem : asset.assetId;
  const prefix = asset.kind === "image" ? "media/images" : "media/videos";
  let nextPath = `${prefix}/${safeStem}${extension}`;
  let index = 2;

  while (usedPaths.has(nextPath)) {
    nextPath = `${prefix}/${safeStem}-${index}${extension}`;
    index += 1;
  }

  usedPaths.add(nextPath);

  return {
    assetId: asset.assetId,
    kind: asset.kind,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    path: nextPath,
  };
}

export async function buildProjectPackageBundle(
  loadedProject: LoadedProjectRecord,
) {
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const assets = loadedProject.media.map((mediaEntry) =>
    buildAssetPath(mediaEntry, usedPaths),
  );
  const exportedAt = new Date().toISOString();
  const manifest = buildProjectPackageManifest({
    projectId: loadedProject.record.id,
    projectName: loadedProject.record.name,
    exportedAt,
    assets,
  });

  zip.file(
    manifest.projectPath,
    JSON.stringify(buildProjectFile(loadedProject.record), null, 2),
  );
  zip.file(manifest.manifestPath, JSON.stringify(manifest, null, 2));
  zip.file(
    "exports/README.txt",
    "This folder is reserved for future rendered exports.\n",
  );

  for (const asset of assets) {
    const mediaEntry = loadedProject.media.find(
      (record) => record.assetId === asset.assetId,
    );

    if (!mediaEntry) {
      continue;
    }

    zip.file(asset.path, mediaEntry.blob);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const fileName = `${sanitizeFileNamePart(
    loadedProject.record.name,
    "project",
  )}.pencil-project.zip`;

  return {
    blob,
    fileName,
    manifest,
  };
}

export async function importProjectPackage(file: File): Promise<ImportedProjectPackage> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file("package-manifest.json");
  const projectFile = zip.file("project.json");

  if (!manifestFile || !projectFile) {
    throw new Error("项目包缺少 package-manifest.json 或 project.json。");
  }

  const manifest = JSON.parse(
    await manifestFile.async("text"),
  ) as ReturnType<typeof buildProjectPackageManifest>;
  const parsedProjectFile = JSON.parse(
    await projectFile.async("text"),
  ) as ProjectPackageProjectFile;

  if (!parsedProjectFile.snapshot) {
    throw new Error("项目包里的 project.json 结构无效。");
  }

  const media: ProjectMediaInput[] = [];

  for (const asset of manifest.assets) {
    const entry = zip.file(asset.path);

    if (!entry) {
      continue;
    }

    media.push({
      assetId: asset.assetId,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      blob: await entry.async("blob"),
    });
  }

  return {
    name: parsedProjectFile.project.name,
    description: parsedProjectFile.project.description,
    previewImageUrl: parsedProjectFile.project.previewImageUrl,
    snapshot: parsedProjectFile.snapshot,
    media,
  };
}
