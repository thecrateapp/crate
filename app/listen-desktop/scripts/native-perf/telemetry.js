const WRITE_TEXT_FILE_COMMAND = "plugin:fs|write_text_file";

function offlineIndexWritePath(command, options) {
  if (command !== WRITE_TEXT_FILE_COMMAND) return null;
  const encodedPath = options?.headers?.path;
  if (typeof encodedPath !== "string") return null;

  let path = encodedPath;
  try {
    path = decodeURIComponent(encodedPath);
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

export function installNativePerfTelemetry(
  stats,
  internals = window.__TAURI_INTERNALS__,
  now = () => performance.now(),
) {
  if (!internals || typeof internals.invoke !== "function") {
    throw new Error("Tauri invoke bridge is unavailable for write telemetry");
  }

  const originalInvoke = internals.invoke;
  const observedInvoke = async function (command, args, options) {
    const path = offlineIndexWritePath(command, options);
    const startedAt = path ? now() : 0;
    const result = await originalInvoke.call(this, command, args, options);
    if (path) {
      stats.indexWriteCalls += 1;
      stats.indexWriteBytes += byteLength(args);
      stats.indexWriteDurationsMs.push(Math.max(0, now() - startedAt));
    }
    return result;
  };

  internals.invoke = observedInvoke;
  return () => {
    if (internals.invoke === observedInvoke) internals.invoke = originalInvoke;
  };
}
