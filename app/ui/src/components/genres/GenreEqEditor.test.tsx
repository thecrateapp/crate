import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GenreEqEditor } from "./GenreEqEditor";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const FLAT = Array.from({ length: 10 }, () => 0);

describe("GenreEqEditor", () => {
  it("labels the editor with a mono heading naming the genre", () => {
    render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
      />,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Equalizer preset Shoegaze");
    expect(heading).toHaveClass("font-mono", "uppercase");
  });

  it("marks a direct preset with the accent status dot", () => {
    render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
      />,
    );

    expect(
      screen.getByText("Direct preset").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "on");
  });

  it("shows inheritance as an idle status and a missing preset as a warning", () => {
    const { rerender } = render(
      <GenreEqEditor
        canonicalSlug="dream-pop"
        canonicalName="Dream pop"
        initialGains={null}
        initialResolved={{
          gains: FLAT,
          source: "inherited",
          slug: "shoegaze",
          name: "Shoegaze",
        }}
      />,
    );

    expect(
      screen.getByText("Inherits from Shoegaze").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "off");

    rerender(
      <GenreEqEditor
        canonicalSlug="dream-pop"
        canonicalName="Dream pop"
        initialGains={null}
        initialResolved={null}
      />,
    );

    expect(
      screen.getByText("No preset").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "warn");
  });

  it("commits a keyboard edit and draws without animation under reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const requestFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
      />,
    );
    const slider = screen.getAllByRole("slider")[4]!;

    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.blur(slider);

    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(requestFrame).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
