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
const runtimeSecretGenerations = new Map<string, number>();
const pendingSecretWrites = new Set<Promise<void>>();
const writeChains = new Map<string, Promise<void>>();
const PENDING_SECRET_REMOVALS_KEY = "crate-pending-session-removals:v1";
const SECRET_GENERATIONS_KEY = "crate-session-generations:v1";

interface SecureServerSecretRecord extends ServerSecret {
  generation: number;
}

function secureSessionKey(serverId: string): string {
  return `crate.session.${serverId}`;
}

function emptySecret(): ServerSecret {
  return { token: null, refreshToken: null };
}

function readSecretGenerations(): Map<string, number> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SECRET_GENERATIONS_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" &&
          Number.isSafeInteger(entry[1]) &&
          entry[1] >= 0,
      ),
    );
  } catch {
    return new Map();
  }
}

function writeSecretGenerations(generations: Map<string, number>): void {
  localStorage.setItem(
    SECRET_GENERATIONS_KEY,
    JSON.stringify(Object.fromEntries(generations)),
  );
}

function observeSecretGeneration(serverId: string, generation: number): void {
  const runtimeGeneration = runtimeSecretGenerations.get(serverId) ?? 0;
  if (generation > runtimeGeneration) {
    runtimeSecretGenerations.set(serverId, generation);
  }
  const generations = readSecretGenerations();
  if ((generations.get(serverId) ?? 0) >= generation) return;
  generations.set(serverId, generation);
  writeSecretGenerations(generations);
}

function nextSecretGeneration(serverId: string): number {
  const generations = readSecretGenerations();
  const pendingGeneration = readPendingSecretRemovals().get(serverId) ?? 0;
  const runtimeGeneration = runtimeSecretGenerations.get(serverId) ?? 0;
  const next =
    Math.max(
      generations.get(serverId) ?? 0,
      pendingGeneration,
      runtimeGeneration,
    ) + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error("Native session generation exhausted");
  }
  generations.set(serverId, next);
  runtimeSecretGenerations.set(serverId, next);
  writeSecretGenerations(generations);
  return next;
}

function readPendingSecretRemovals(): Map<string, number> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PENDING_SECRET_REMOVALS_KEY) ?? "{}",
    );
    if (Array.isArray(parsed)) {
      return new Map(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map((serverId) => [serverId, 1]),
      );
    }
    if (!parsed || typeof parsed !== "object") return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isSafeInteger(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

function writePendingSecretRemovals(removals: Map<string, number>): void {
  if (removals.size === 0) {
    localStorage.removeItem(PENDING_SECRET_REMOVALS_KEY);
    return;
  }
  localStorage.setItem(
    PENDING_SECRET_REMOVALS_KEY,
    JSON.stringify(Object.fromEntries(removals)),
  );
}

function markSecretRemovalPending(serverId: string, generation: number): void {
  const pending = readPendingSecretRemovals();
  pending.set(serverId, generation);
  writePendingSecretRemovals(pending);
}

function clearPendingSecretRemoval(serverId: string, generation: number): void {
  const pending = readPendingSecretRemovals();
  if (pending.get(serverId) !== generation) return;
  pending.delete(serverId);
  writePendingSecretRemovals(pending);
}

async function retryPendingSecretRemovals(): Promise<void> {
  await Promise.all(
    [...readPendingSecretRemovals()].map(async ([serverId, generation]) => {
      try {
        // A login that completed after this logout carries a newer generation.
        // Keep it even if the process crashed before clearing the old tombstone.
        const current = parseSecureServerSecret(
          await getSecureSessionValue(secureSessionKey(serverId)),
        );
        observeSecretGeneration(serverId, current.generation);
        if (current.generation > generation) {
          clearPendingSecretRemoval(serverId, generation);
          return;
        }
        // Each tombstone is independent; one unavailable Keychain entry must not
        // prevent the remaining active sessions from loading at startup.
        await removeSecureSessionValue(secureSessionKey(serverId));
        clearPendingSecretRemoval(serverId, generation);
      } catch {
        // Keep the tombstone durable so the next bootstrap retries it again.
      }
    }),
  );
}

export function parseServerSecret(value: string | null): ServerSecret {
  return parseSecureServerSecret(value).secret;
}

function parseSecureServerSecret(value: string | null): {
  secret: ServerSecret;
  generation: number;
} {
  if (!value) return { secret: emptySecret(), generation: 0 };
  try {
    const parsed = JSON.parse(value) as Partial<SecureServerSecretRecord>;
    return {
      secret: {
        token: typeof parsed.token === "string" ? parsed.token : null,
        refreshToken:
          typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
      },
      generation:
        typeof parsed.generation === "number" &&
        Number.isSafeInteger(parsed.generation) &&
        parsed.generation >= 0
          ? parsed.generation
          : 0,
    };
  } catch {
    return { secret: emptySecret(), generation: 0 };
  }
}

function serializeSecret(secret: ServerSecret, generation: number): string {
  return JSON.stringify({ ...secret, generation });
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
  const generation = nextSecretGeneration(serverId);
  const supersededRemovalGeneration = readPendingSecretRemovals().get(serverId);
  enqueueSecretWrite(serverId, async () => {
    await setSecureSessionValue(
      secureSessionKey(serverId),
      serializeSecret(secret, generation),
    );
    // A successful login supersedes any failed logout queued for this same
    // server. Leaving that tombstone behind would delete the new session on
    // the next bootstrap.
    if (supersededRemovalGeneration !== undefined) {
      clearPendingSecretRemoval(serverId, supersededRemovalGeneration);
    }
  });
}

function queueSecretRemoval(serverId: string): void {
  const generation = nextSecretGeneration(serverId);
  markSecretRemovalPending(serverId, generation);
  enqueueSecretWrite(serverId, async () => {
    await removeSecureSessionValue(secureSessionKey(serverId));
    clearPendingSecretRemoval(serverId, generation);
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
  const pendingRemovals = readPendingSecretRemovals();
  const nextSecrets = new Map<string, ServerSecret>();

  for (const server of records) {
    if (pendingRemovals.has(server.id)) {
      nextSecrets.set(server.id, emptySecret());
      continue;
    }
    const legacySecret: ServerSecret = {
      token: server.token ?? null,
      refreshToken: server.refreshToken ?? null,
    };
    if (legacySecret.token || legacySecret.refreshToken) {
      const generation = nextSecretGeneration(server.id);
      const serialized = serializeSecret(legacySecret, generation);
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
    const secureRecord = parseSecureServerSecret(
      await getSecureSessionValue(secureSessionKey(server.id)),
    );
    observeSecretGeneration(server.id, secureRecord.generation);
    nextSecrets.set(server.id, secureRecord.secret);
  }

  return nextSecrets;
}
