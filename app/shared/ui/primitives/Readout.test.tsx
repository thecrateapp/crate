import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Readout } from "./Readout";

describe("Readout", () => {
  it("separates the visible React content from its committed announcement", () => {
    const { container } = render(
      <Readout announcement="Custom preset committed">
        <strong>Custom</strong> · +3 dB
      </Readout>,
    );
    const visible = screen.getByText("Custom").closest('[aria-hidden="true"]');
    const live = screen.getByRole("status");

    expect(visible).toHaveTextContent("Custom · +3 dB");
    expect(visible).not.toContainElement(live);
    expect(live).toHaveClass("sr-only");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-atomic", "true");
    expect(live).toHaveTextContent(/^Custom preset committed$/);
    expect(container.querySelector(".crate-readout")).toBeInTheDocument();
  });

  it("does not mutate the live region when only the visible preview changes", () => {
    const { rerender } = render(
      <Readout announcement="Flat preset">Flat</Readout>,
    );
    const live = screen.getByRole("status");
    const committedText = live.firstChild;
    const mutations = new MutationObserver(() => {});
    mutations.observe(live, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    rerender(<Readout announcement="Flat preset">Shoegaze preview</Readout>);

    expect(screen.getByText("Shoegaze preview")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("status")).toBe(live);
    expect(live.firstChild).toBe(committedText);
    expect(live).toHaveTextContent(/^Flat preset$/);
    expect(mutations.takeRecords()).toHaveLength(0);
    mutations.disconnect();

    rerender(<Readout announcement="Shoegaze preset">Shoegaze</Readout>);
    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^Shoegaze preset$/);
  });

  it("keeps an empty live region mounted until an announcement is supplied", () => {
    const { rerender } = render(<Readout>Preview only</Readout>);
    const live = screen.getByRole("status");
    expect(live).toBeEmptyDOMElement();

    rerender(<Readout announcement="Ready">Ready</Readout>);
    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^Ready$/);

    rerender(<Readout>Another preview</Readout>);
    expect(screen.getByRole("status")).toBe(live);
    expect(live).toBeEmptyDOMElement();
  });

  it("reserves twelve characters by default and updates a custom width", () => {
    const { container, rerender } = render(<Readout>Flat</Readout>);
    const readout = container.querySelector<HTMLElement>(".crate-readout")!;
    expect(readout.style.getPropertyValue("--readout-min-width")).toBe("12ch");

    rerender(<Readout minWidthCh={24}>Adaptive active</Readout>);
    expect(readout.style.getPropertyValue("--readout-min-width")).toBe("24ch");

    rerender(<Readout>Flat</Readout>);
    expect(readout.style.getPropertyValue("--readout-min-width")).toBe("12ch");
  });
});
