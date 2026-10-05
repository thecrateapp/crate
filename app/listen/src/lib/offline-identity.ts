const OFFLINE_IDENTITY_SCHEMA_VERSION = 1;
const OFFLINE_IDENTITY_STORAGE_PREFIX = "listen-offline-identity:v1:";

export interface LocalOfflineIdentity {
  schemaVersion: 1;
  serverId: string;
  serverUrl: string;
  userId: number;
  profileKey: string;
  generation: number;
}

interface ActiveIdentityRecord {
  schemaVersion: 1;
  state: "active";
  generation: number;
  identity: LocalOfflineIdentity;
}

interface RevokedIdentityRecord {
  schemaVersion: 1;
  state: "revoked";
  generation: number;
}

type IdentityRecord = ActiveIdentityRecord | RevokedIdentityRecord;

export function getOfflineIdentityStorageKey(serverId: string): string {
  return `${OFFLINE_IDENTITY_STORAGE_PREFIX}${encodeURIComponent(serverId)}`;
}

function normalizeServerUrl(serverUrl: string): string | null {
  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (parsed.username || parsed.password) return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function readRecord(serverId: string): IdentityRecord | null {
  try {
    const raw = localStorage.getItem(getOfflineIdentityStorageKey(serverId));
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<IdentityRecord>;
    if (
      record.schemaVersion !== OFFLINE_IDENTITY_SCHEMA_VERSION ||
      !Number.isSafeInteger(record.generation) ||
      Number(record.generation) < 1
    ) {
      return null;
    }
    if (record.state === "revoked") {
      return {
        schemaVersion: 1,
        state: "revoked",
        generation: Number(record.generation),
      };
    }
    if (record.state !== "active" || !record.identity) return null;

    const identity = record.identity as Partial<LocalOfflineIdentity>;
    const serverUrl =
      typeof identity.serverUrl === "string"
        ? normalizeServerUrl(identity.serverUrl)
        : null;
    if (
      identity.schemaVersion !== 1 ||
      identity.serverId !== serverId ||
      !serverUrl ||
      !Number.isSafeInteger(identity.userId) ||
      Number(identity.userId) <= 0 ||
      typeof identity.profileKey !== "string" ||
      !identity.profileKey.trim() ||
      identity.generation !== record.generation
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      state: "active",
      generation: Number(record.generation),
      identity: {
        schemaVersion: 1,
        serverId,
        serverUrl,
        userId: Number(identity.userId),
        profileKey: identity.profileKey,
        generation: Number(record.generation),
      },
    };
  } catch {
    return null;
  }
}

export function persistVerifiedOfflineIdentity(input: {
  serverId: string;
  serverUrl: string;
  userId: number;
  profileKey: string;
}): LocalOfflineIdentity | null {
  const serverId = input.serverId.trim();
  const serverUrl = normalizeServerUrl(input.serverUrl);
  if (
    !serverId ||
    !serverUrl ||
    !Number.isSafeInteger(input.userId) ||
    input.userId <= 0 ||
    !input.profileKey.trim()
  ) {
    return null;
  }

  const generation = (readRecord(serverId)?.generation ?? 0) + 1;
  const identity: LocalOfflineIdentity = {
    schemaVersion: 1,
    serverId,
    serverUrl,
    userId: input.userId,
    profileKey: input.profileKey,
    generation,
  };
  const record: ActiveIdentityRecord = {
    schemaVersion: 1,
    state: "active",
    generation,
    identity,
  };
  try {
    localStorage.setItem(
      getOfflineIdentityStorageKey(serverId),
      JSON.stringify(record),
    );
    return identity;
  } catch {
    return null;
  }
}

export function getOfflineIdentityForServer(
  serverId: string,
  serverUrl: string,
): LocalOfflineIdentity | null {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  if (!serverId.trim() || !normalizedServerUrl) return null;
  const record = readRecord(serverId);
  if (
    record?.state !== "active" ||
    record.identity.serverUrl !== normalizedServerUrl
  ) {
    return null;
  }
  return record.identity;
}

export function revokeOfflineIdentityForServer(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  if (!normalizedServerId) return false;
  const generation = (readRecord(normalizedServerId)?.generation ?? 0) + 1;
  const record: RevokedIdentityRecord = {
    schemaVersion: 1,
    state: "revoked",
    generation,
  };
  const storageKey = getOfflineIdentityStorageKey(normalizedServerId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(record));
    return true;
  } catch {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Without a durable tombstone, remove the active record if possible.
    }
    return false;
  }
}
