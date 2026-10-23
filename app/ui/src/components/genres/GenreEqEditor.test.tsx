import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { GenreEqEditor } from "./GenreEqEditor";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const FLAT = Array.from({ length: 10 }, () => 0);

describe("GenreEqEditor", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

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

  it("supports an embedded presentation without a duplicate card heading", () => {
    const { container } = render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
        embedded
      />,
    );

    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByText("10-band curve · Shoegaze")).toBeVisible();
    expect(container.firstElementChild).toHaveClass("min-w-0");
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

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(/^In sync with database$/);
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled();
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(live).toHaveTextContent(/^In sync with database$/);
    fireEvent.blur(slider);

    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^Unsaved changes$/);
    expect(screen.getByRole("button", { name: "Save preset" })).toBeEnabled();
    expect(requestFrame).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("renders one flat hairline panel on tokens, with no nested boxes", () => {
    const { container } = render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
      />,
    );

    const boxed = Array.from(
      container.querySelectorAll<HTMLElement>("div"),
    ).filter((node) => /(^|\s)border(\s|$)/.test(node.className));
    expect(boxed).toHaveLength(1);
    expect(boxed[0]).toHaveClass("border-border-quiet");
    expect(container.innerHTML).not.toMatch(
      /white\/|bg-black|#[0-9a-f]{3,6}\b/i,
    );
  });

  it("announces synchronization after the saved preset is returned by the parent", async () => {
    vi.mocked(api).mockResolvedValue({});
    const onSaved = vi.fn();
    const props = {
      canonicalSlug: "shoegaze",
      canonicalName: "Shoegaze",
      initialGains: FLAT,
      initialResolved: null,
      onSaved,
    };
    const { rerender } = render(<GenreEqEditor {...props} />);
    const live = screen.getByRole("status");
    const slider = screen.getAllByRole("slider")[4]!;
    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.blur(slider);
    expect(live).toHaveTextContent(/^Unsaved changes$/);

    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    const savedGains = FLAT.map((gain, index) => (index === 4 ? 3 : gain));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith(
      "/api/genres/shoegaze/eq-preset",
      "PATCH",
      { gains: savedGains },
    );
    rerender(<GenreEqEditor {...props} initialGains={savedGains} />);

    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^In sync with database$/);
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled();
  });

  it("announces when resetting to the stored flat curve discards an edit", () => {
    render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
      />,
    );
    const live = screen.getByRole("status");
    const slider = screen.getAllByRole("slider")[4]!;
    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.blur(slider);
    expect(live).toHaveTextContent(/^Unsaved changes$/);

    const reset = screen.getByRole("button", {
      name: "Reset sliders to flat",
    });
    expect(reset).not.toHaveAttribute("title");
    fireEvent.click(reset);

    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^In sync with database$/);
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
  });

  it("shows the shared tooltip for the reset icon", async () => {
    render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]}
        initialResolved={null}
      />,
    );

    await userEvent.hover(
      screen.getByRole("button", { name: "Reset sliders to flat" }),
    );

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Reset sliders to flat",
    );
  });

  it("stages the EQ from the full AI proposal until the curator saves it", async () => {
    const proposed = [2, 1, 0, -1, -2, -1, 0, 1, 2, 1];
    vi.mocked(api).mockResolvedValue({});
    const onSaved = vi.fn();
    render(
      <GenreEqEditor
        canonicalSlug="shoegaze"
        canonicalName="Shoegaze"
        initialGains={FLAT}
        initialResolved={null}
        aiProposalGains={proposed}
        aiProposalReasoning="Lift the presence gently."
        embedded
        onSaved={onSaved}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "AI proposal · unsaved",
      ),
    );
    expect(
      screen
        .getAllByRole("slider")
        .map((slider) => slider.getAttribute("aria-valuenow")),
    ).toEqual(proposed.map(String));
    expect(screen.getByText("Lift the presence gently.")).toBeVisible();
    expect(api).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith(
      "/api/genres/shoegaze/eq-preset",
      "PATCH",
      { gains: proposed },
    );
  });
});
