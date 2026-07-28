export interface OfflineTaskRunResult {
  completed: number;
  cancelled: boolean;
}

export async function runBoundedOfflineTasks<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<OfflineTaskRunResult> {
  const concurrency = Math.max(
    1,
    Math.min(Math.floor(options.concurrency ?? 2), items.length || 1),
  );
  let nextIndex = 0;
  let completed = 0;

  const runWorker = async () => {
    while (!options.signal?.aborted) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;
      await worker(items[index] as T, index);
      completed += 1;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));
  return {
    completed,
    cancelled: Boolean(options.signal?.aborted),
  };
}

interface OfflineNetworkInformation extends EventTarget {
  effectiveType?: string;
  saveData?: boolean;
}

function offlineTransfersAllowed(): boolean {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    return false;
  }
  if (typeof navigator === "undefined") return true;
  if (!navigator.onLine) return false;
  const connection = (
    navigator as Navigator & { connection?: OfflineNetworkInformation }
  ).connection;
  return (
    !connection?.saveData &&
    connection?.effectiveType !== "slow-2g" &&
    connection?.effectiveType !== "2g"
  );
}

export function waitForOfflineTransferPermission(
  signal?: AbortSignal,
): Promise<void> {
  if (offlineTransfersAllowed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const connection = (
      navigator as Navigator & { connection?: OfflineNetworkInformation }
    ).connection;
    const cleanup = () => {
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      connection?.removeEventListener("change", check);
      signal?.removeEventListener("abort", abort);
    };
    const check = () => {
      if (!offlineTransfersAllowed()) return;
      cleanup();
      resolve();
    };
    const abort = () => {
      cleanup();
      const error = new Error("Offline transfer cancelled");
      error.name = "AbortError";
      reject(error);
    };
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    connection?.addEventListener("change", check);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export interface CoalescedOfflineWriter<T> {
  schedule(value: T): void;
  flush(): void;
  dispose(): void;
}

export function createCoalescedOfflineWriter<T>(
  write: (value: T) => void,
  delayMs = 100,
): CoalescedOfflineWriter<T> {
  let pending: T | undefined;
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!hasPending) return;
    const value = pending as T;
    pending = undefined;
    hasPending = false;
    write(value);
  };

  return {
    schedule(value) {
      pending = value;
      hasPending = true;
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
    dispose: flush,
  };
}
