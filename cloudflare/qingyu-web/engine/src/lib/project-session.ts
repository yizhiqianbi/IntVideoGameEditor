const ACTIVE_PROJECT_STORAGE_KEY = "int-video-game-editor.active-project-id.v1";

export function getStoredActiveProjectId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
}

export function setStoredActiveProjectId(projectId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
}

export function clearStoredActiveProjectId() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
}
