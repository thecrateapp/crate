import { beforeEach, describe, expect, it } from "vitest";

import {
  getOfflineIdentityForServer,
  getOfflineIdentityStorageKey,
  persistVerifiedOfflineIdentity,
  revokeOfflineIdentityForServer,
} from "@/lib/offline-identity";

describe("offline identity persistence", () => {
  beforeEach(() => localStorage.clear());

  it("stores a verified identity scoped to the exact server and profile", () => {
    const identity = persistVerifiedOfflineIdentity({
      serverId: "server-a",
      serverUrl: "https://a.example.test/",
      userId: 42,
      profileKey: "profile-a-42",
    });

    expect(identity).toMatchObject({
      schemaVersion: 1,
      serverId: "server-a",
      serverUrl: "https://a.example.test",
      userId: 42,
      profileKey: "profile-a-42",
      generation: 1,
    });
    expect(
      getOfflineIdentityForServer("server-a", "https://a.example.test"),
    ).toEqual(identity);
    expect(
      getOfflineIdentityForServer("server-b", "https://a.example.test"),
    ).toBeNull();
    expect(
      getOfflineIdentityForServer("server-a", "https://other.example.test"),
    ).toBeNull();
  });

  it("keeps a higher-generation tombstone after explicit revocation", () => {
    persistVerifiedOfflineIdentity({
      serverId: "server-a",
      serverUrl: "https://a.example.test",
      userId: 42,
      profileKey: "profile-a-42",
    });

    expect(revokeOfflineIdentityForServer("server-a")).toBe(true);
    expect(
      getOfflineIdentityForServer("server-a", "https://a.example.test"),
    ).toBeNull();
    expect(
      JSON.parse(
        localStorage.getItem(getOfflineIdentityStorageKey("server-a"))!,
      ),
    ).toMatchObject({ schemaVersion: 1, state: "revoked", generation: 2 });

    const reauthenticated = persistVerifiedOfflineIdentity({
      serverId: "server-a",
      serverUrl: "https://a.example.test",
      userId: 42,
      profileKey: "profile-a-42",
    });
    expect(reauthenticated?.generation).toBe(3);
  });

  it("fails closed on malformed records and invalid identity input", () => {
    localStorage.setItem(
      getOfflineIdentityStorageKey("server-a"),
      '{"schemaVersion":1,"state":"active","generation":9}',
    );
    expect(
      getOfflineIdentityForServer("server-a", "https://a.example.test"),
    ).toBeNull();
    expect(
      persistVerifiedOfflineIdentity({
        serverId: "server-a",
        serverUrl: "file:///tmp/server",
        userId: 42,
        profileKey: "profile-a-42",
      }),
    ).toBeNull();
  });
});
