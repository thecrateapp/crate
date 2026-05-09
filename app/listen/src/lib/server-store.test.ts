import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = vi.hoisted(() => ({
  isNative: true,
}));

vi.mock("@/lib/capacitor", () => ({
  get isNative() {
    return runtimeState.isNative;
  },
}));

import {
  addServer,
  getCurrentServer,
  getServers,
  seedDefaultServer,
  setCurrentServerId,
} from "@/lib/server-store";

describe("server-store", () => {
  beforeEach(() => {
    runtimeState.isNative = true;
    localStorage.clear();
  });

  it("seeds a build-time default server for fresh native installs", () => {
    seedDefaultServer("https://listen.lespedants.org/");

    expect(getServers()).toHaveLength(1);
    expect(getCurrentServer()).toMatchObject({
      label: "listen.lespedants.org",
      url: "https://listen.lespedants.org",
      token: null,
      refreshToken: null,
    });
  });

  it("does not override an existing native server", () => {
    const existing = addServer("https://crate.example.test");
    setCurrentServerId(existing.id);

    seedDefaultServer("https://listen.lespedants.org");

    expect(getServers()).toHaveLength(1);
    expect(getCurrentServer()?.url).toBe("https://crate.example.test");
  });

  it("does not seed web runtime storage", () => {
    runtimeState.isNative = false;

    seedDefaultServer("https://listen.lespedants.org");

    expect(getServers()).toEqual([]);
    expect(getCurrentServer()).toBeNull();
  });
});
