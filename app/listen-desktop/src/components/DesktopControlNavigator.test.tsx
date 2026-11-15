// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router";

import { dispatchDesktopControlCommand } from "@/lib/desktop-control";

import { DesktopControlNavigator } from "./DesktopControlNavigator";

function Where() {
  const location = useLocation();
  return (
    <output data-testid="where">{location.pathname + location.search}</output>
  );
}

function renderNavigator() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <DesktopControlNavigator />
      <Where />
    </MemoryRouter>,
  );
}

function relay(detail: unknown) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("crate:desktop-control-command", { detail }),
    );
  });
}

describe("DesktopControlNavigator", () => {
  afterEach(() => cleanup());

  it("opens an artist page", () => {
    renderNavigator();
    act(() => {
      dispatchDesktopControlCommand({
        cmd: "show",
        item: {
          kind: "artist",
          artist: { name: "Repion", artistId: 3, artistSlug: "repion" },
        },
      });
    });
    expect(screen.getByTestId("where").textContent).toBe("/artists/repion");
  });

  it("opens an album page", () => {
    renderNavigator();
    relay({
      cmd: "show",
      item: {
        kind: "album",
        album: {
          album: "Pronto",
          artist: "Repion",
          albumId: 11,
          albumSlug: "pronto",
          artistSlug: "repion",
        },
      },
    });
    expect(screen.getByTestId("where").textContent).toBe(
      "/artists/repion/pronto",
    );
  });

  it("opens a track's album with the track highlighted", () => {
    renderNavigator();
    relay({
      cmd: "show",
      item: {
        kind: "track",
        track: {
          title: "Barrio Somavilla",
          artist: "Repion",
          album: "Pronto",
          album_id: 11,
          album_slug: "pronto",
          artist_slug: "repion",
          entity_uid: "t-9",
        },
      },
    });
    expect(screen.getByTestId("where").textContent).toBe(
      "/artists/repion/pronto?track=t-9",
    );
  });

  it("ignores other commands and refs without a page", () => {
    renderNavigator();
    relay({ cmd: "set_volume", volume: 0.2 });
    relay({ cmd: "show" });
    relay({
      cmd: "show",
      item: { kind: "track", track: { title: "x", artist: "y", album: "" } },
    });
    expect(screen.getByTestId("where").textContent).toBe("/");
  });
});
