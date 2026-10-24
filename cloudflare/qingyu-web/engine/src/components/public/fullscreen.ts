type FullscreenElementLike = {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocumentLike = {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export function getFullscreenElement(documentLike: FullscreenDocumentLike) {
  return documentLike.fullscreenElement ?? documentLike.webkitFullscreenElement ?? null;
}

export function isFullscreenSupported(elementLike: FullscreenElementLike) {
  return Boolean(elementLike.requestFullscreen || elementLike.webkitRequestFullscreen);
}

export async function requestElementFullscreen(elementLike: FullscreenElementLike) {
  if (elementLike.requestFullscreen) {
    await elementLike.requestFullscreen();
    return;
  }

  if (elementLike.webkitRequestFullscreen) {
    await elementLike.webkitRequestFullscreen();
  }
}

export async function exitDocumentFullscreen(documentLike: FullscreenDocumentLike) {
  if (documentLike.exitFullscreen) {
    await documentLike.exitFullscreen();
    return;
  }

  if (documentLike.webkitExitFullscreen) {
    await documentLike.webkitExitFullscreen();
  }
}
