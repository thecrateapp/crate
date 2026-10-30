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
const stepButton = (step: number) =>
  screen.getByRole("button", {
    name: `Play step ${step}: Track ${step} by Coast`,
  });
afterEach(() => {
  delete document.documentElement.dataset.crateMotion;
});
describe("path cover journey", () => {
  it("keeps unavailable steps in roving focus but rejects pointer and keyboard playback", async () => {
    const user = userEvent.setup();
    const play = vi.fn();
    renderJourney(
      <PathCoverJourneyView
        steps={steps
          .slice(0, 3)
          .map((step, index) => ({ ...step, playable: index !== 1 }))}
        origin="A"
        destination="B"
        activeStep={0}
        currentTrackKey="track-1"
        onPlay={play}
      />,
    );

    const unavailable = screen.getByRole("button", {
      name: /^Play step 2: Track 2 by Coast/,
    });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    expect(unavailable).toHaveAccessibleName(/unavailable/i);
    expect(stepButton(1)).not.toHaveAccessibleName(/unavailable/i);
    fireEvent.click(unavailable);
    expect(play).not.toHaveBeenCalled();
    stepButton(1).focus();
    await user.keyboard("{ArrowRight}");
    expect(unavailable).toHaveFocus();
    expect(unavailable).toHaveAttribute("tabindex", "0");
    await user.keyboard("{Enter}");
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(play).toHaveBeenCalledWith(2);
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });
  it("follows actual track changes and ignores play/pause", () => {
    const view = (active: number, playing: boolean) => (
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        activeStep={active}
        currentTrackKey={`track-${active + 1}`}
        playing={playing}
        onPlay={vi.fn()}
      />
    );
    const { rerender, container } = renderJourney(view(2, true));
    expect(screen.getByText("3 of 50")).toBeInTheDocument();
    rerender(view(2, false));
    expect(screen.getByText("3 of 50")).toBeInTheDocument();
    rerender(view(10, true));
    expect(screen.getByText("11 of 50")).toBeInTheDocument();
    expect(container.querySelectorAll(".path-step-thumb")).toHaveLength(50);
    expect(stepButton(11)).toHaveAttribute("aria-current", "step");
  });
  it("has no step buttons that would move the stage without the queue", () => {
    renderJourney(
      <PathCoverJourneyView
        steps={steps}
        origin="A"
        destination="B"
        onPlay={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Next step" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous step" })).toBeNull();
  });
  it("moves keyboard focus through the strip without changing the stage, then Enter plays", async () => {
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
    stepButton(1).focus();
    await user.keyboard("{End}");
    expect(stepButton(50)).toHaveFocus();
    expect(stepButton(50)).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("1 of 50")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(stepButton(49)).toHaveFocus();
    expect(play).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(play).toHaveBeenCalledWith(48);
    expect(screen.getByText("49 of 50")).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(stepButton(1)).toHaveFocus();
    expect(screen.getByText("49 of 50")).toBeInTheDocument();
  });
  it("does not steal external focus after keyboard boundaries", async () => {
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
    stepButton(3).focus();
    await user.keyboard("{Home}{ArrowLeft}");
    expect(stepButton(1)).toHaveFocus();
    const other = screen.getByRole("button", { name: "Other control" });
    other.focus();
    rerender(view(3));
    expect(screen.getByText("4 of 50")).toBeInTheDocument();
    expect(other).toHaveFocus();
  });
  it("moves focus with a changed current track only when focus is inside the step strip", async () => {
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
    stepButton(3).focus();
    rerender(view(30));
    expect(stepButton(31)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(play).toHaveBeenCalledWith(30);
  });
  it("keeps the chosen step across list refreshes and follows same-position track replacements", () => {
    const play = vi.fn();
    const view = (list: typeof steps, key: string) => (
      <PathCoverJourneyView
        steps={list}
        origin="A"
        destination="B"
        activeStep={0}
        currentTrackKey={key}
        onPlay={play}
      />
    );
    const { rerender } = renderJourney(view(steps.slice(0, 5), "first-track"));
    fireEvent.click(stepButton(2));
    expect(play).toHaveBeenCalledWith(1);
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
  it("shows the chosen cover on stage and the travelled route up to the playing step", () => {
    const covered = steps.slice(0, 6).map((step) => ({
      ...step,
      coverUrl: `/covers/${step.index}.jpg`,
    }));
    const play = vi.fn();
    const { container } = renderJourney(
      <PathCoverJourneyView
        steps={covered}
        origin="Ambient"
        destination="Techno"
        activeStep={3}
        currentTrackKey="track-4"
        onPlay={play}
      />,
    );
    const stageImage = () =>
      container.querySelector('[data-slot="path-cover-stage"] img');
    expect(stageImage()).toHaveAttribute("src", "/covers/3.jpg");
    fireEvent.click(stepButton(5));
    expect(play).toHaveBeenCalledWith(4);
    expect(stageImage()).toHaveAttribute("src", "/covers/4.jpg");
    const track = container.querySelector<HTMLElement>(".path-step-track")!;
    expect(track).toHaveAttribute("role", "group");
    expect(track.style.getPropertyValue("--path-step-progress")).toBe("3");
    const thumbs = container.querySelectorAll(".path-step-thumb");
    expect(thumbs[2]).toHaveAttribute("data-past");
    expect(thumbs[3]).not.toHaveAttribute("data-past");
    expect(thumbs[4]).toHaveAttribute("data-focused");
    expect(screen.getByText("Ambient")).toBeInTheDocument();
    expect(screen.getByText("Techno")).toBeInTheDocument();
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
    expect(stepButton(1)).toHaveAttribute("tabindex", "0");
    expect(within(stepButton(1)).queryByRole("img")).toBeNull();
  });
});
