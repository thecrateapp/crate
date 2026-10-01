function offlineIndexWritePath(path) {
  if (typeof path !== "string") return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the encoded form so a malformed path cannot disable measurement.
  }
  return path.includes("offline-assets-") && path.endsWith(".next")
    ? path
    : null;
}

function byteLength(data) {
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (typeof data === "string")
    return new TextEncoder().encode(data).byteLength;
  return 0;
}

export async function writeTextFileWithTelemetry(
  writeTextFile,
  path,
  data,
  options,
  target = window,
  now = () => performance.now(),
) {
  const startedAt = now();
  const result = await writeTextFile(path, data, options);
  try {
    target.__crateNativePerfRecordWrite?.(
      path,
      data,
      Math.max(0, now() - startedAt),
    );
  } catch {
    // Benchmark instrumentation must not change filesystem operation results.
  }
  return result;
}

export function installNativePerfTelemetry(stats, target = window) {
  const originalObserver = target.__crateNativePerfRecordWrite;
  const observer = (path, data, durationMs) => {
    if (!offlineIndexWritePath(path)) return;
    stats.indexWriteCalls += 1;
    stats.indexWriteBytes += byteLength(data);
    stats.indexWriteDurationsMs.push(Math.max(0, durationMs));
  };
  target.__crateNativePerfRecordWrite = observer;
  return () => {
    if (target.__crateNativePerfRecordWrite !== observer) return;
    if (originalObserver === undefined)
      delete target.__crateNativePerfRecordWrite;
    else target.__crateNativePerfRecordWrite = originalObserver;
  };
}
