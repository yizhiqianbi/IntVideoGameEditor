const SHARE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** The path X can fetch. A hash is discarded before the request leaves the browser. */
export function characterSharePath(id: string): string | null {
  return SHARE_ID.test(id) ? `/c/${id}` : null;
}

export function characterLinkId(pathname: string): string | null {
  try { pathname = decodeURIComponent(pathname); } catch { return null; }
  return pathname.replace(/\/+$/, "").toLowerCase().match(/^(?:\/(?:en|zh-cn|zh-tw|jp|ko))?\/c\/([a-z0-9][a-z0-9-]{0,119})$/)?.[1] ?? null;
}
