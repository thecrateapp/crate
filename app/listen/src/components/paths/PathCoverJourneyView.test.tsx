import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "@/i18n";
const renderJourney = (ui: ReactElement) =>
  render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider initialLocale="en">{children}</I18nProvider>
    ),
  });
import { PathCoverJourneyView } from "./PathCoverJourneyView";
const steps = Array.from({ length: 50 }, (_, index) => ({
  index,
  title: `Track ${index + 1}`,
  artist: "Coast",
}));
afterEach(() => {
  delete document.documentElement.dataset.crateMotion;
});
describe("path coverflow", () => {
  it("follows changed tracks, but keeps manual inspection on play/pause changes", () => {
    const play = vi.fn();
    const { rerender, container } = renderJourney(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={2}
        currentTrackKey="track-3"
        playing
        onPlay={play}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("4 of 50")).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
    rerender(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={2}
        currentTrackKey="track-3"
        playing={false}
        onPlay={play}
      />,
    );
    expect(screen.getByText("4 of 50")).toBeInTheDocument();
    rerender(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={10}
        currentTrackKey="track-11"
        playing
        onPlay={play}
      />,
    );
    expect(screen.getByText("11 of 50")).toBeInTheDocument();
    expect(container.querySelectorAll(".path-cover-step")).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: "Play step 11: Track 11 by Coast" }),
    ).toHaveAttribute("aria-current", "step");
  });
  it("inspects the complete path with keyboard without playing, then Enter plays the actual step", async () => {
    const user = userEvent.setup(),
      play = vi.fn();
    renderJourney(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={0}
        currentTrackKey="track-1"
        onPlay={play}
      />,
    );
    screen
      .getByRole("button", { name: "Play step 1: Track 1 by Coast" })
      .focus();
    await user.keyboard("{End}");
    expect(screen.getByText("50 of 50")).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(play).toHaveBeenCalledWith(49);
    await user.keyboard("{Home}");
    expect(screen.getByText("1 of 50")).toBeInTheDocument();
  });
  it("does not arm a focus request at a keyboard boundary or steal external focus", async () => {
    const user = userEvent.setup();
    const view = (active: number) => (
      <>
        <button type="button">Other control</button>
        <PathCoverJourneyView
          steps={steps}
          origin="A"
          destination="B"
          activeStep={active}
          currentTrackKey={`track-${active}`}
          onPlay={vi.fn()}
        />
      </>
    );
    const { rerender } = renderJourney(view(2));
    screen
      .getByRole("button", { name: "Play step 3: Track 3 by Coast" })
      .focus();
    await user.keyboard("{Home}{ArrowLeft}");
    const other = screen.getByRole("button", { name: "Other control" });
    other.focus();
    rerender(view(3));
    expect(screen.getByText("4 of 50")).toBeInTheDocument();
    expect(other).toHaveFocus();
  });
  it("moves focus with a changed current track only when focus is inside the coverflow", async () => {
    const user = userEvent.setup(),
      play = vi.fn();
    const view = (active: number) => (
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={active}
        currentTrackKey={`track-${active}`}
        onPlay={play}
      />
    );
    const { rerender } = renderJourney(view(2));
    screen
      .getByRole("button", { name: "Play step 3: Track 3 by Coast" })
      .focus();
    rerender(view(30));
    expect(
      screen.getByRole("button", { name: "Play step 31: Track 31 by Coast" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(play).toHaveBeenCalledWith(30);
  });
  it("preserves inspection across list refreshes and follows same-position track replacements", () => {
    const view = (list: typeof steps, key: string) => (
      <PathCoverJourneyView
        steps={list}
        origin="A"
        destination="B"
        activeStep={0}
        currentTrackKey={key}
        onPlay={vi.fn()}
      />
    );
    const { rerender } = renderJourney(view(steps.slice(0, 5), "first-track"));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    rerender(view(steps.slice(0, 6), "first-track"));
    expect(screen.getByText("2 of 6")).toBeInTheDocument();
    rerender(
      view(
        [{ ...steps[0]!, title: "Replacement" }, ...steps.slice(1, 6)],
        "replacement-track",
      ),
    );
    expect(screen.getByText("1 of 6")).toBeInTheDocument();
    expect(screen.getByText("Replacement")).toBeInTheDocument();
  });
  it("uses a static composition for reduced motion, even when the playing track changes", () => {
    document.documentElement.dataset.crateMotion = "reduced";
    const { container, rerender } = renderJourney(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={0}
        currentTrackKey="track-1"
        onPlay={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-slot="path-cover-journey"]'),
    ).toHaveAttribute("data-motion", "off");
    rerender(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={4}
        currentTrackKey="track-5"
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getByText("5 of 50")).toBeInTheDocument();
  });
  it("keeps missing covers and empty/single paths usable", () => {
    const { rerender } = renderJourney(
      <PathCoverJourneyView
        steps={[]}
        origin="A"
        destination="B"
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getByText("No tracks in this path")).toBeInTheDocument();
    rerender(
      <PathCoverJourneyView
        steps={steps.slice(0, 1)}
        origin="A"
        destination="B"
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
    expect(
      within(
        screen.getByRole("button", { name: "Play step 1: Track 1 by Coast" }),
      ).queryByRole("img"),
    ).toBeNull();
  });
});
