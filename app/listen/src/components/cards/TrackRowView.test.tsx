import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrackRowView } from "./TrackRowView";
import { TrackRowContent } from "./TrackRowContent";

describe("actual local Listen track presentation", () => {
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
          quality="FLAC 24/96"
          explicitLabel="Explicit"
          actions={null}
        />
      </TrackRowView>,
    );
    expect(screen.getByText("FLAC 24/96")).toHaveAttribute(
      "data-slot",
      "info-badge",
    );
    expect(screen.getByText("E")).toHaveAttribute("data-slot", "info-badge");
  });
});
