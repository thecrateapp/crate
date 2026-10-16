import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScanProgress, type ScanProgressData } from "./ScanProgress";

function scan(overrides: Partial<ScanProgressData> = {}): ScanProgressData {
  return {
    scanner: "naming",
    artist: "Slowdive",
    artists_done: 2,
    artists_total: 8,
    issues_found: 1,
    issues_by_type: { bad_naming: 1 },
    scanners_done: ["nested"],
    scanners_total: 5,
    current_scanner_index: 1,
    ...overrides,
  };
}

describe("ScanProgress", () => {
  it("exposes real artist progress and keeps scanner, issue and artist context", () => {
    const { rerender } = render(<ScanProgress progress={scan()} />);
    const bar = screen.getByRole("progressbar", { name: /scan/i });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/2.*8/),
    );
    expect(
      screen.getByText(/Scanning artist 2\/8 \(25%\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Slowdive")).toBeInTheDocument();
    expect(screen.getByText("Naming: 1")).toBeInTheDocument();

    rerender(<ScanProgress progress={scan({ artists_done: 4 })} />);
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/4.*8/),
    );
  });

  it("keeps a scan with an unknown artist total indeterminate instead of claiming zero percent", () => {
    render(
      <ScanProgress progress={scan({ artists_done: 0, artists_total: 0 })} />,
    );
    const bar = screen.getByRole("progressbar", { name: /scan/i });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("data-indeterminate", "true");
    expect(screen.getByText("Slowdive")).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
});
