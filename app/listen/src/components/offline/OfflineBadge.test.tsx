import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { OfflineBadge } from "./OfflineBadge";

describe("OfflineBadge", () => {
  it("returns null for idle state", () => {
    const { container } = render(<OfflineBadge state="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders ready badge", () => {
    const { container } = render(<OfflineBadge state="ready" />);
    expect(container.textContent).toContain("Available offline");
  });

  it("renders error badge", () => {
    const { container } = render(<OfflineBadge state="error" />);
    expect(container.textContent).toContain("Offline copy failed");
  });

  it("renders compact badge without label", () => {
    const { container } = render(<OfflineBadge state="ready" compact />);
    expect(container.textContent).not.toContain("Available offline");
  });

  it("renders subtle badge", () => {
    const { container } = render(<OfflineBadge state="downloading" subtle />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
