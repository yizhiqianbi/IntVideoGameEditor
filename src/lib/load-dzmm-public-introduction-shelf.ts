let pending: Promise<typeof import("./dzmm-public-introduction-shelf")> | null = null;

export function loadDzmmPublicIntroductionShelf() {
  pending ??= import("./dzmm-public-introduction-shelf");
  return pending;
}
