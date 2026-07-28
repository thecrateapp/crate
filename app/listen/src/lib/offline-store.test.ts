import { beforeEach, describe, expect, it } from "vitest";

import {
  encodeOfflineProfileIdentity,
  readOfflineStoreItem,
  writeOfflineStoreItem,
} from "@/lib/offline-store";

describe("offline metadata store", () => {
  beforeEach(() => localStorage.clear());

  it("encodes server/user identities without path separators", () => {
    const key = encodeOfflineProfileIdentity(
      "https://crate.example|listener@example",
    );

    expect(key).not.toMatch(/[+/=]/);
  });

  it("round-trips and removes metadata", () => {
    writeOfflineStoreItem("offline-key", "value");
    expect(readOfflineStoreItem("offline-key")).toBe("value");

    writeOfflineStoreItem("offline-key", null);
    expect(readOfflineStoreItem("offline-key")).toBeNull();
  });
});
