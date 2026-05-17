import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrackCoverThumb } from "./TrackCoverThumb";

describe("TrackCoverThumb", () => {
  it("renders fallback icon when no src", () => {
    const { container } = render(<TrackCoverThumb />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders image when src is provided", () => {
    render(<TrackCoverThumb src="https://example.com/cover.jpg" alt="Cover" />);
    expect(screen.getByAltText("Cover")).toHaveAttribute(
      "src",
      "https://example.com/cover.jpg",
    );
  });

  it("switches to fallback on image error", () => {
    const { container } = render(<TrackCoverThumb src="invalid.jpg" />);
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    fireEvent.error(img!);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<TrackCoverThumb className="rounded-md" />);
    expect(container.firstChild).toHaveClass("rounded-md");
  });
});
