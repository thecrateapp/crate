import { createRef } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EngineMixState } from "@/lib/playback-engine";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { PlayerMixIndicator } from "./PlayerMixIndicator";
import { resolvePlayerMixPresentation } from "./player-mix-presentation";
import { SpinningDiscFrame } from "./SpinningDiscFrame";

const mixing: EngineMixState = {
  revision: "queue-1",
  executionId: 7,
  mode: "crossfade",
  phase: "mixing",
  bassHandoff: false,
  outgoingTrackId: "out",
  incomingTrackId: "in",
  durationMs: 4000,
};

function presentation(state: EngineMixState | null = mixing, isPlaying = true) {
  return resolvePlayerMixPresentation(state, {
    currentTrackId: "out",
    isPlaying,
    isBuffering: false,
  });
}

describe("actual player mix presentation", () => {
  it("does not invent a mode when native telemetry is unavailable", () => {
    renderWithListenProviders(<PlayerMixIndicator mix={presentation(null)} />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(status).not.toHaveAttribute("data-mix-mode");
    expect(status).toHaveClass("min-h-4");
  });

  it("uses the same blue token for real Crossfade and the existing one-pixel ring", () => {
    const mix = presentation()!;
    const { container } = renderWithListenProviders(
      <>
        <SpinningDiscFrame
          rotorRef={createRef()}
          artwork={null}
          control={null}
          mixTone={mix.ringTone}
        />
        <PlayerMixIndicator mix={mix} />
      </>,
    );
    const status = screen.getByRole("status", { name: "Transition" });
    expect(status).toHaveTextContent("Crossfade");
    expect(status.style.color).toBe("var(--state-info)");
    const ring = container.querySelector<HTMLElement>(
      ".spinning-disc-overlay",
    )!;
    expect(ring.style.borderColor).toBe(status.style.color);
    expect(container.querySelectorAll(".spinning-disc-overlay")).toHaveLength(
      1,
    );
    expect(status).not.toHaveTextContent(/planned|next|previst/i);
  });

  it("uses yellow only for confirmed Beatmatch and names applied Bass handoff", () => {
    renderWithListenProviders(
      <PlayerMixIndicator
        mix={presentation({ ...mixing, mode: "beatmatch", bassHandoff: true })}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Beatmatch");
    expect(status).toHaveTextContent("Bass swap");
    expect(status.style.color).toBe("var(--state-warning)");
    expect(
      presentation({ ...mixing, mode: "beatmatch", bassHandoff: false })
        ?.bassHandoff,
    ).toBe(false);
  });

  it("keeps Gapless neutral and does not light the disc ring", () => {
    const mix = presentation({
      ...mixing,
      mode: "gapless",
      phase: "idle",
      durationMs: 0,
    })!;
    renderWithListenProviders(<PlayerMixIndicator mix={mix} />);
    expect(screen.getByRole("status")).toHaveTextContent("Gapless");
    expect(screen.getByRole("status").style.color).toBe("var(--text-subtle)");
    expect(mix.ringTone).toBeUndefined();
  });

  it("makes a paused or buffering mix neutral and clears a finished transition", () => {
    expect(presentation(mixing, false)?.ringTone).toBeUndefined();
    expect(presentation(mixing, false)?.color).toBe("var(--text-subtle)");
    expect(
      resolvePlayerMixPresentation(mixing, {
        currentTrackId: "in",
        isPlaying: true,
        isBuffering: true,
      })?.ringTone,
    ).toBeUndefined();
    expect(presentation({ ...mixing, phase: "idle" })).toBeNull();
    const { rerender } = renderWithListenProviders(
      <PlayerMixIndicator mix={presentation()} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<PlayerMixIndicator mix={null} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("rejects a stale edge while allowing either deck during handoff", () => {
    expect(
      resolvePlayerMixPresentation(mixing, {
        currentTrackId: "other",
        isPlaying: true,
        isBuffering: false,
      }),
    ).toBeNull();
    expect(
      resolvePlayerMixPresentation(mixing, {
        currentTrackId: "in",
        isPlaying: true,
        isBuffering: false,
      })?.ringTone,
    ).toBe("crossfade");
  });

  it("localizes the readout and describes paused playback without relying on color", () => {
    renderWithListenProviders(
      <PlayerMixIndicator mix={presentation(mixing, false)} />,
      { locale: "es" },
    );
    const status = screen.getByRole("status", { name: "Transición" });
    expect(status).toHaveTextContent("Crossfade");
    expect(status).toHaveTextContent("En pausa");
  });
});
