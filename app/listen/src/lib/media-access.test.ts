import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMediaAccessTickets,
  getMediaAccessTargets,
  getMediaAccessTicketsVersion,
  getMediaAccessTicket,
  setMediaAccessTickets,
  subscribeMediaAccessTickets,
} from "@/lib/media-access";

describe("media access ticket cache", () => {
  beforeEach(() => clearMediaAccessTickets());

  it("returns only a fresh ticket for the requested audience", () => {
    setMediaAccessTickets(
      [
        {
          audience: "artwork",
          path: "/api/albums/12/cover",
          ticket: "artwork-ticket",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        {
          audience: "stream",
          path: "/api/tracks/12/stream",
          ticket: "stream-ticket",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      "server-a",
    );

    expect(
      getMediaAccessTicket("artwork", "/api/albums/12/cover", "server-a"),
    ).toBe("artwork-ticket");
    expect(
      getMediaAccessTicket("stream", "/api/tracks/12/stream", "server-a"),
    ).toBe("stream-ticket");
    expect(getMediaAccessTicket("sse", "/api/events", "server-a")).toBeNull();
  });

  it("does not reuse a ticket for another path in the same audience", () => {
    setMediaAccessTickets(
      [
        {
          audience: "artwork",
          path: "/api/albums/12/cover",
          ticket: "album-cover-ticket",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      "server-a",
    );

    expect(
      getMediaAccessTicket("artwork", "/api/albums/12/cover", "server-a"),
    ).toBe("album-cover-ticket");
    expect(
      getMediaAccessTicket("artwork", "/api/artists/99/photo", "server-a"),
    ).toBeNull();
  });

  it("does not expose an expired ticket", () => {
    setMediaAccessTickets(
      [
        {
          audience: "artwork",
          path: "/api/albums/12/cover",
          ticket: "expired",
          expires_at: new Date(Date.now() - 1).toISOString(),
        },
      ],
      "server-a",
    );

    expect(
      getMediaAccessTicket("artwork", "/api/albums/12/cover", "server-a"),
    ).toBeNull();
  });

  it("does not expose a ticket issued for another server", () => {
    setMediaAccessTickets(
      [
        {
          audience: "artwork",
          path: "/api/albums/12/cover",
          ticket: "server-a-ticket",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      "server-a",
    );

    expect(
      getMediaAccessTicket("artwork", "/api/albums/12/cover", "server-b"),
    ).toBeNull();
  });

  it("remembers requested paths so short-lived tickets can be refreshed", () => {
    expect(
      getMediaAccessTicket("sse", "/api/events/task/task-1", "server-a"),
    ).toBeNull();

    expect(getMediaAccessTargets("server-a")).toEqual([
      {
        audience: "sse",
        path: "/api/events/task/task-1",
      },
    ]);
  });

  it("notifies the authenticated tree when media URLs need rebuilding", () => {
    const listener = vi.fn();
    const initialVersion = getMediaAccessTicketsVersion();
    const unsubscribe = subscribeMediaAccessTickets(listener);

    setMediaAccessTickets([], "server-a");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getMediaAccessTicketsVersion()).toBe(initialVersion + 1);

    unsubscribe();
    clearMediaAccessTickets();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
