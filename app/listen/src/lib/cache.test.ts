import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheClear,
  scopesForUrl,
  onCacheInvalidation,
} from "./cache";

beforeEach(() => {
  cacheClear();
  localStorage.clear();
});

describe("scopesForUrl", () => {
  it("returns home scopes for discovery", () => {
    expect(scopesForUrl("/api/me/home/discovery")).toEqual([
      "home",
      "library",
      "follows",
      "history",
      "likes",
    ]);
  });

  it("returns likes scope for likes endpoint", () => {
    expect(scopesForUrl("/api/me/likes")).toEqual(["likes"]);
  });

  it("returns playlist scope with id", () => {
    expect(scopesForUrl("/api/playlists/42")).toEqual([
      "playlists",
      "playlist:42",
    ]);
  });

  it("returns artist scope with id", () => {
    expect(scopesForUrl("/api/artists/7")).toEqual([
      "artist:7",
      "library",
      "follows",
    ]);
  });

  it("returns empty for unknown urls", () => {
    expect(scopesForUrl("/api/unknown")).toEqual([]);
  });
});

describe("cacheGet / cacheSet", () => {
  it("returns null for unset keys", () => {
    expect(cacheGet("/api/foo")).toBeNull();
  });

  it("stores and retrieves data", () => {
    cacheSet("/api/foo", { bar: 1 });
    expect(cacheGet("/api/foo")).toEqual({ bar: 1 });
  });

  it("falls back to localStorage", () => {
    localStorage.setItem(
      "crate-api-cache:/api/foo",
      JSON.stringify({ data: { bar: 2 }, timestamp: Date.now(), scopes: [] }),
    );
    expect(cacheGet("/api/foo")).toEqual({ bar: 2 });
  });

  it("ignores expired localStorage entries", () => {
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      "crate-api-cache:/api/foo",
      JSON.stringify({ data: { bar: 3 }, timestamp: old, scopes: [] }),
    );
    expect(cacheGet("/api/foo")).toBeNull();
  });
});

describe("cacheInvalidate", () => {
  it("removes entries matching scope", () => {
    cacheSet("/api/me/likes", [1]);
    cacheSet("/api/me/follows", [2]);
    cacheInvalidate("likes");
    expect(cacheGet("/api/me/likes")).toBeNull();
    expect(cacheGet("/api/me/follows")).not.toBeNull();
  });
});

describe("cacheClear", () => {
  it("removes all entries", () => {
    cacheSet("/api/a", 1);
    cacheSet("/api/b", 2);
    cacheClear();
    expect(cacheGet("/api/a")).toBeNull();
    expect(cacheGet("/api/b")).toBeNull();
  });
});

describe("onCacheInvalidation", () => {
  it("returns an unsubscribe function", () => {
    const fn = vi.fn();
    const unsub = onCacheInvalidation(fn);
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
