import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QualityBadge } from "./QualityBadge";

describe("QualityBadge", () => {
  it("renders hi-res source badge with icon", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "hi-res", label: "HI-RES", detail: "24-bit / 96 kHz" }}
      />,
    );
    expect(container.textContent).toContain("HI-RES");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders stream badge without icon", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "lossless", label: "Lossless", detail: "FLAC" }}
        origin="stream"
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders standard badge without icon", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "standard", label: "MP3", detail: "320 kbps" }}
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
