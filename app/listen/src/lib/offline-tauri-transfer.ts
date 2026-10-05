import { getApiBase } from "@/lib/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";
import { getOfflineIdentityForServer } from "@/lib/offline-identity";
import { getCurrentServer, getCurrentServerId } from "@/lib/server-store";

export interface TauriOfflineTransferOptions {
  profileKey: string;
  assetKey: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

interface OfflineTransferScope {
  serverId: string;
  serverUrl: string;
  userId: number;
  profileKey: string;
  generation: number;
  assetKey: string;
}

function createAbortError(): Error {
  const error = new Error("Offline transfer cancelled");
  error.name = "AbortError";
  return error;
}

function getTransferScope(
  profileKey: string,
  assetKey: string,
): OfflineTransferScope {
  const server = getCurrentServer();
  const serverId = getCurrentServerId() ?? "web";
  const serverUrl = server?.url || getApiBase() || window.location.origin;
  const identity = getOfflineIdentityForServer(serverId, serverUrl);
  const storedUserId = Number(getStoredAuthUserId(serverUrl));
  if (
    !identity ||
    identity.profileKey !== profileKey ||
    identity.userId !== storedUserId
  ) {
    throw new Error("Offline transfer requires a verified active identity");
  }
  return {
    serverId,
    serverUrl: identity.serverUrl,
    userId: identity.userId,
    profileKey,
    generation: identity.generation,
    assetKey,
  };
}

export async function downloadTauriOfflineAsset({
  profileKey,
  assetKey,
  url,
  path,
  headers,
  signal,
}: TauriOfflineTransferOptions): Promise<void> {
  const invoke = window.__crateTauriInvoke;
  if (!invoke) throw new Error("Tauri offline transfer bridge is unavailable");
  if (signal?.aborted) throw createAbortError();

  const scope = getTransferScope(profileKey, assetKey);
  const transferId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `offline-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2)}`;
  let registered = false;
  let cancelPromise: Promise<unknown> | null = null;
  const cancel = () => {
    cancelPromise ??= invoke("cancel_offline_transfer", {
      transferId,
      scope,
    }).catch(() => undefined);
  };
  const onAbort = () => cancel();

  try {
    await invoke("register_offline_transfer", { transferId, scope });
    registered = true;
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    try {
      await invoke("download_offline_media", {
        transferId,
        scope,
        url,
        path,
        headers,
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      throw error;
    }

    if (signal?.aborted) throw createAbortError();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) cancel();
    if (cancelPromise) await cancelPromise;
    if (registered) {
      await invoke("unregister_offline_transfer", {
        transferId,
        scope,
      }).catch(() => undefined);
    }
  }
}
