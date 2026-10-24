const REFERENCE = /^\/api\/h3\/references\/([a-f0-9]{32})$/;

/** Browser paths the site may forward. The GPU token never belongs in this map. */
export function h3Upstream(method: string, path: string): string | null {
  if (method === "GET" && path === "/api/h3/health") return "/pencil/health";
  if (method === "POST" && path === "/api/h3/prompt") return "/pencil/h3/prompt";
  if (method === "POST" && path === "/api/h3/cancel") return "/pencil/generate/cancel";
  if (method === "POST" && path === "/api/h3/image") return "/pencil/input-image";
  if (method === "POST" && path === "/api/h3/references") return "/pencil/references";
  const reference = method === "GET" ? REFERENCE.exec(path) : null;
  return reference ? `/pencil/references/${reference[1]}` : null;
}

export function h3Query(path: string, search: string): string | null {
  if (search === "") return "";
  if (path.startsWith("/api/h3/references/") && search === "?metadata=1") return "?metadata=1";
  return null;
}
