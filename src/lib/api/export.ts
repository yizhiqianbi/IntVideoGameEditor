/**
 * Proxies a remote media URL through the server to bypass CORS.
 * Used when building interactive export bundles.
 */
export async function fetchRemoteMedia(url: string): Promise<Blob> {
  const res = await fetch("/api/export/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    throw new Error(`下载媒体失败 (HTTP ${res.status})`);
  }

  return res.blob();
}
