let pending: Promise<typeof import("./shelf-public-introduction-shelf")> | null = null;

export function loadShelfPublicIntroductionShelf() {
  pending ??= import("./shelf-public-introduction-shelf");
  return pending;
}
