import {
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "@/lib/native-secure-session";
import { isCapacitorRuntime } from "@/lib/platform";

export interface ServerSecret {
  token: string | null;
  refreshToken: string | null;
}

export interface LegacyServerSecretRecord {
  id: string;
  token?: string | null;
  refreshToken?: string | null;
}

const runtimeSecrets = new Map<string, ServerSecret>();
const pendingSecretWrites = new Set<Promise<void>>();
const writeChains = new Map<string, Promise<void>>();
const PENDING_SECRET_REMOVALS_KEY = "crate-pending-session-removals:v1";

function secureSessionKey(serverId: string): string {
  return `crate.session.${serverId}`;
}

function emptySecret(): ServerSecret {
  return { token: null, refreshToken: null };
}

function readPendingSecretRemovals(): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PENDING_SECRET_REMOVALS_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writePendingSecretRemovals(serverIds: Set<string>): void {
  try {
    if (serverIds.size === 0) {
      localStorage.removeItem(PENDING_SECRET_REMOVALS_KEY);
      return;
    }
    localStorage.setItem(
      PENDING_SECRET_REMOVALS_KEY,
      JSON.stringify([...serverIds]),
    );
  } catch {
    // Secure storage remains authoritative when local metadata is unavailable.
  }
}

function markSecretRemovalPending(serverId: string): void {
  const pending = readPendingSecretRemovals();
  pending.add(serverId);
  writePendingSecretRemovals(pending);
}

function clearPendingSecretRemoval(serverId: string): void {
  const pending = readPendingSecretRemovals();
  pending.delete(serverId);
  writePendingSecretRemovals(pending);
}

async function retryPendingSecretRemovals(): Promise<void> {
  for (const serverId of readPendingSecretRemovals()) {
    try {
      // Each tombstone is independent; one unavailable Keychain entry must not
      // prevent the remaining active sessions from loading at startup.
      // react-doctor-disable-next-line async-await-in-loop
      await removeSecureSessionValue(secureSessionKey(serverId));
      clearPendingSecretRemoval(serverId);
    } catch {
      // Keep the tombstone durable so the next bootstrap retries it again.
    }
  }
}

export function parseServerSecret(value: string | null): ServerSecret {
  if (!value) return emptySecret();
  try {
    const parsed = JSON.parse(value) as Partial<ServerSecret>;
    return {
      token: typeof parsed.token === "string" ? parsed.token : null,
      refreshToken:
        typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    };
  } catch {
    return emptySecret();
  }
}

function serializeSecret(secret: ServerSecret): string {
  return JSON.stringify(secret);
}

export function getRuntimeServerSecret(serverId: string): ServerSecret {
  return runtimeSecrets.get(serverId) ?? emptySecret();
}

export function setRuntimeServerSecret(
  serverId: string,
  secret: ServerSecret,
): void {
  runtimeSecrets.set(serverId, secret);
}

export function removeRuntimeServerSecret(serverId: string): void {
  runtimeSecrets.delete(serverId);
}

export function clearRuntimeServerSecrets(): void {
  runtimeSecrets.clear();
}

function trackSecretWrite(operation: Promise<void>): void {
  pendingSecretWrites.add(operation);
  void operation
    .catch(() => undefined)
    .finally(() => pendingSecretWrites.delete(operation));
}

// Two writes for the same server (e.g. a token refresh's set() racing a
// logout's remove()) aren't guaranteed to land in the order we issued them —
// whichever secure-storage call finishes last wins, which could silently
// resurrect a just-logged-out session or leave a stale token behind. Chaining
// per-server keeps writes applied in issue order without blocking writes to
// other servers.
function enqueueSecretWrite(
  serverId: string,
  operation: () => Promise<void>,
): void {
  const previous = writeChains.get(serverId) ?? Promise.resolve();
  const gated = previous.then(operation, operation);
  writeChains.set(
    serverId,
    gated.catch(() => undefined),
  );
  trackSecretWrite(gated);
}

export function queueSecretWrite(serverId: string, secret: ServerSecret): void {
  if (!isCapacitorRuntime) return;
  if (!secret.token && !secret.refreshToken) {
    queueSecretRemoval(serverId);
    return;
  }
  enqueueSecretWrite(serverId, async () => {
    await setSecureSessionValue(
      secureSessionKey(serverId),
      serializeSecret(secret),
    );
    // A successful login supersedes any failed logout queued for this same
    // server. Leaving that tombstone behind would delete the new session on
    // the next bootstrap.
    clearPendingSecretRemoval(serverId);
  });
}

function queueSecretRemoval(serverId: string): void {
  markSecretRemovalPending(serverId);
  enqueueSecretWrite(serverId, async () => {
    await removeSecureSessionValue(secureSessionKey(serverId));
    clearPendingSecretRemoval(serverId);
  });
}

export function removeQueuedSecret(serverId: string): void {
  if (!isCapacitorRuntime) return;
  queueSecretRemoval(serverId);
}

export async function waitForPendingSecureSessionWrites(): Promise<void> {
  const results = await Promise.allSettled([...pendingSecretWrites]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Native session persistence failed");
  }
}

export async function loadNativeServerSecrets(
  records: readonly LegacyServerSecretRecord[],
): Promise<Map<string, ServerSecret>> {
  await retryPendingSecretRemovals();
  const nextSecrets = new Map<string, ServerSecret>();

  for (const server of records) {
    const legacySecret: ServerSecret = {
      token: server.token ?? null,
      refreshToken: server.refreshToken ?? null,
    };
    if (legacySecret.token || legacySecret.refreshToken) {
      const serialized = serializeSecret(legacySecret);
      // Migrate and verify one server secret at a time to keep persistence atomic.
      // react-doctor-disable-next-line async-await-in-loop
      await setSecureSessionValue(secureSessionKey(server.id), serialized);
      const verified = await getSecureSessionValue(secureSessionKey(server.id));
      if (verified !== serialized) {
        throw new Error("Secure session verification failed");
      }
      nextSecrets.set(server.id, legacySecret);
      continue;
    }
    nextSecrets.set(
      server.id,
      parseServerSecret(
        await getSecureSessionValue(secureSessionKey(server.id)),
      ),
    );
  }

  return nextSecrets;
}
