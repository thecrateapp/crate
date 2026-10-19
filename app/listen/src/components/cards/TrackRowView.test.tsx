import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrackRowView } from "./TrackRowView";
import { TrackRowContent } from "./TrackRowContent";

describe("actual local Listen track presentation", () => {
  it("uses the Hairline selection surface without claiming current playback", () => {
    render(<TrackRowView selected aria-selected aria-label="Selected track" />);
    const row = screen.getByRole("row", { name: "Selected track" });
    expect(row).toHaveClass("crate-row-highlight");
    expect(row).toHaveAttribute("data-selected", "true");
    expect(row).not.toHaveAttribute("aria-current");
  });
  it("owns current/disabled frame state while preserving native identity, ref and handlers", () => {
    const click = vi.fn();
    const ref = createRef<HTMLDivElement>();
    const view = render(
      <TrackRowView
        active
        selected
        aria-selected
        aria-label="Marea"
        ref={ref}
        onClick={click}
      >
        Marea
      </TrackRowView>,
    );
    const row = screen.getByRole("row", { name: "Marea" });
    expect(ref.current).toBe(row);
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("aria-selected", "true");
    fireEvent.click(row);
    expect(click).toHaveBeenCalledTimes(1);
    view.rerender(
      <TrackRowView disabled aria-label="Marea">
        Marea
      </TrackRowView>,
    );
    expect(screen.getByRole("row", { name: "Marea" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
  it("uses canonical informational badges for quality and explicit flags", () => {
    render(
      <TrackRowView>
        <TrackRowContent
          leading={null}
          title="Marea"
          quality={{
            label: "Hi-Res 24/96",
            tier: "hi-res",
            detail: "24-bit / 96 kHz",
          }}
          explicitLabel="Explicit"
          actions={null}
        />
      </TrackRowView>,
    );
    expect(
      screen.getByText("Hi-Res 24/96").closest('[data-slot="info-badge"]'),
    ).toHaveAttribute("data-slot", "info-badge");
    expect(screen.getByText("E")).toHaveAttribute("data-slot", "info-badge");
  });

  it("keeps separate metadata slots when some tracks lack source, analysis or duration", () => {
    const { container } = render(
      <TrackRowView>
        <TrackRowContent leading={null} title="Unknown" actions={null} />
      </TrackRowView>,
    );
    for (const slot of ["quality", "analysis", "duration", "like", "actions"]) {
      expect(
        container.querySelector(`[data-track-slot="${slot}"]`),
      ).toBeInTheDocument();
    }
    expect(container.querySelector('[data-slot="info-badge"]')).toBeNull();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
