export const CRITICAL_STATIC_ASSETS: readonly string[];
export function assetMimeTypes(relativePath: string): string[];
export function matchesAssetMime(relativePath: string, contentType: string | null): boolean;
