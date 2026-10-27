import { describe, expect, it } from "vitest";
import { reachesProduction } from "./guard";

describe("reachesProduction", () => {
  it.each([
    { method: "GET", url: "http://localhost:5174/api/albums/1", passes: true },
    { method: "HEAD", url: "http://localhost:5174/api/stream/1", passes: true },
    {
      method: "OPTIONS",
      url: "https://api.lespedants.org/api/me",
      passes: true,
    },
    {
      method: "POST",
      url: "http://localhost:5174/api/auth/refresh",
      passes: true,
    },
    {
      method: "post",
      url: "https://api.lespedants.org/api/auth/media-access",
      passes: true,
    },
    {
      method: "POST",
      url: "http://localhost:5174/api/me/play-events",
      passes: false,
    },
    {
      method: "POST",
      url: "https://api.lespedants.org/api/me/play-events?batch=1",
      passes: false,
    },
    {
      method: "PUT",
      url: "http://localhost:5173/api/admin/settings",
      passes: false,
    },
    {
      method: "DELETE",
      url: "http://localhost:5174/api/playlists/3",
      passes: false,
    },
    {
      method: "POST",
      url: "http://localhost:5173/api/tasks/scan",
      passes: false,
    },
    { method: "POST", url: "http://localhost:5174/src/main.tsx", passes: true },
  ])("$method $url passes: $passes", ({ method, url, passes }) => {
    expect(reachesProduction(method, url)).toBe(passes);
  });
});
