export const XUMENG_CREATOR_LOAD_DEADLINE_MS = 12_000;

export type CreatorSectionResult<T> = {
  index: number;
  result: PromiseSettledResult<T>;
  pending: number;
};

function boundedLoad<T>(load: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = new AbortController();
    let finished = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    function finish(result: PromiseSettledResult<T>) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      parent.removeEventListener("abort", cancel);
      if (result.status === "fulfilled") resolve(result.value);
      else reject(result.reason);
    }
    function cancel() {
      finish({ status: "rejected", reason: new DOMException("创作列表加载已取消。", "AbortError") });
      child.abort();
    }
    if (parent.aborted) { cancel(); return; }
    parent.addEventListener("abort", cancel, { once: true });
    deadline = setTimeout(() => {
      // Settle independently of whether the transport honors AbortSignal.
      finish({ status: "rejected", reason: new Error("这类作品加载超时，请刷新重试。") });
      child.abort();
    }, milliseconds);
    void Promise.resolve().then(() => {
      if (finished) return;
      return load(child.signal);
    }).then(value => {
      if (!finished) finish({ status: "fulfilled", value: value as T });
    }, reason => finish({ status: "rejected", reason }));
  });
}

/** Each completed section becomes usable immediately, even if another hangs. */
export async function loadCreatorSections<T>(
  loads: readonly ((signal: AbortSignal) => Promise<T>)[],
  signal: AbortSignal,
  onResult: (result: CreatorSectionResult<T>) => void,
  deadlineMs = XUMENG_CREATOR_LOAD_DEADLINE_MS,
): Promise<void> {
  let pending = loads.length;
  await Promise.all(loads.map((load, index) => boundedLoad(load, signal, deadlineMs).then(
    value => { pending--; if (!signal.aborted) onResult({ index, result: { status: "fulfilled", value }, pending }); },
    reason => { pending--; if (!signal.aborted) onResult({ index, result: { status: "rejected", reason }, pending }); },
  )));
}
