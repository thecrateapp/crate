import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const imageState = vi.hoisted(
  () =>
    ({ emit: null }) as {
      emit: ((state: "empty" | "loading" | "ready") => void) | null;
    },
);

vi.mock("./CrateImage", () => ({
  CrateImage: ({
    alt,
    className,
    onArtworkStateChange,
  }: {
    alt: string;
    className?: string;
    onArtworkStateChange?: (state: "empty" | "loading" | "ready") => void;
  }) => {
    imageState.emit = onArtworkStateChange ?? null;
    return <img alt={alt} className={className} />;
  },
}));

import { ArtworkSurface } from "./ArtworkSurface";

describe("ArtworkSurface", () => {
  beforeEach(() => {
    imageState.emit = null;
  });

  it("keeps the fallback mounted until the decoded image is ready", () => {
    render(
      <ArtworkSurface
        source="/api/artists/9/photo"
        alt="High Vis"
        fallback={<span>HV</span>}
      />,
    );

    const fallback = screen.getByTestId("artwork-fallback");
    const image = screen.getByRole("img", { name: "High Vis" });
    expect(fallback).toHaveClass("opacity-100");
    expect(image).toHaveClass("opacity-0");

    act(() => imageState.emit?.("ready"));

    expect(fallback).toHaveClass("opacity-0");
    expect(image).toHaveClass("opacity-100");
  });

  it("hides stale art synchronously when the logical entity changes", () => {
    const { rerender } = render(
      <ArtworkSurface
        source="/api/artists/9/photo"
        alt="Artist"
        fallback={<span>HV</span>}
      />,
    );
    act(() => imageState.emit?.("ready"));
    expect(screen.getByRole("img", { name: "Artist" })).toHaveClass(
      "opacity-100",
    );

    rerender(
      <ArtworkSurface
        source="/api/artists/10/photo"
        alt="Artist"
        fallback={<span>CO</span>}
      />,
    );

    expect(screen.getByRole("img", { name: "Artist" })).toHaveClass(
      "opacity-0",
    );
    expect(screen.getByTestId("artwork-fallback")).toHaveClass("opacity-100");
  });
});
