import manifest from "../../../public/dzmm/user-cards/manifest.json";

type ManifestFile = { path: string; bytes: number; sha256: string };

/** The published set is frozen at build time. An extra file in the assets
 * directory must never become downloadable just because its suffix matches. */
export function userCardAssetPaths(value: unknown): ReadonlySet<string> {
  const input = value as { version?: unknown; batch?: unknown; provenance?: unknown; files?: unknown };
  if (!input || input.version !== 1 || input.batch !== "20261024" || input.provenance !== "user-provided" || !Array.isArray(input.files)) {
    throw new Error("用户角色原件清单无效。");
  }
  const result = new Set<string>(["user-cards/manifest.json"]);
  for (const candidate of input.files) {
    const file = candidate as ManifestFile;
    if (!file || typeof file.path !== "string" || !/^20261024\/[a-z0-9][a-z0-9-]{0,79}\.(?:json|png)$/.test(file.path)
      || result.has(`user-cards/${file.path}`) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("用户角色原件路径或校验值无效。");
    result.add(`user-cards/${file.path}`);
  }
  return result;
}

export const XUMENG_USER_CARD_ASSET_PATHS = userCardAssetPaths(manifest);
