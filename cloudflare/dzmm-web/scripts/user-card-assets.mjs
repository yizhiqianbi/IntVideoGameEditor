import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Strict manifest collection, deliberately independent of readdir/recursive
 * copying so excluded archive cards and unrelated files never get published. */
export async function verifiedUserCardAssets(sourceRoot) {
  const root = join(sourceRoot, "user-cards");
  for (const path of [root, join(root, "manifest.json")]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (path.endsWith(".json") ? !info.isFile() : !info.isDirectory())) throw new Error("用户角色原件路径必须是普通文件或目录。");
  }
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || manifest.batch !== "20261024" || manifest.provenance !== "user-provided" || !Array.isArray(manifest.files)) throw new Error("用户角色原件清单无效。");
  const files = new Set(["user-cards/manifest.json"]);
  if (manifest.files.length) {
    const directory = await lstat(join(root, "20261024"));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("用户角色原件目录不能是符号链接。");
  }
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !/^20261024\/[a-z0-9][a-z0-9-]{0,79}\.(?:json|png)$/.test(file.path)
      || files.has(`user-cards/${file.path}`) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("用户角色原件路径或校验值无效。");
    const path = join(root, file.path), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("用户角色原件必须是普通文件。");
    const bytes = await readFile(path);
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("用户角色原件字节校验失败。");
    if (file.path.endsWith(".json")) {
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("用户角色 JSON 原件无效。");
    } else if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") throw new Error("用户角色 PNG 原件无效。");
    files.add(`user-cards/${file.path}`);
  }
  return files;
}
