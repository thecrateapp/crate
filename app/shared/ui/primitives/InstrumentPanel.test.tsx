import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InstrumentPanel } from "./InstrumentPanel";
import { StatusDot } from "./StatusDot";

describe("InstrumentPanel", () => {
  it("names a section from its visible label even without a heading and associates its description", () => {
    render(
      <InstrumentPanel
        as="section"
        label={{ children: "Source" }}
        description="Library source"
      >
        <span>Details</span>
      </InstrumentPanel>,
    );
    const panel = screen.getByRole("region", { name: "Source" });
    expect(panel).toHaveAccessibleDescription("Library source");
    expect(within(panel).queryByRole("heading")).toBeNull();
  });
  it("forwards the heading tone without recoloring descriptions or metadata", () => {
    render(
      <InstrumentPanel
        as="section"
        headingLevel={2}
        label={{ children: "Interface", tone: "accent" }}
        description="Device preferences"
        meta="Updated today"
      >
        <p>Values</p>
      </InstrumentPanel>,
    );
    expect(screen.getByRole("heading", { name: "Interface" })).toHaveClass(
      "text-accent-action-hi",
    );
    expect(screen.getByText("Updated today").closest(".font-mono")).toHaveClass(
      "text-text-subtle",
    );
    expect(
      screen.getByRole("region", { name: "Interface" }),
    ).toHaveAccessibleDescription("Device preferences");
  });

  it("keeps actions, descriptions and measurements outside its status announcement", async () => {
    const { rerender } = render(
      <InstrumentPanel
        as="section"
        headingLevel={2}
        label={{ children: "Resources" }}
        description="Current storage"
        meta="Updated today"
        status="Ready"
        actions={<button type="button">Refresh</button>}
      >
        <span>280 GB</span>
      </InstrumentPanel>,
    );
    const panel = screen.getByRole("region", { name: "Resources" });
    const id = panel.getAttribute("aria-labelledby");
    expect(panel).toHaveAccessibleDescription("Current storage");
    expect(
      within(panel).getByRole("button", { name: "Refresh" }),
    ).toBeVisible();
    expect(panel.querySelector('[aria-live="polite"]')).toHaveTextContent(
      /^Ready$/,
    );
    rerender(
      <InstrumentPanel
        as="section"
        headingLevel={2}
        label={{ children: "Resources" }}
        description={0}
      >
        <span>281 GB</span>
      </InstrumentPanel>,
    );
    expect(panel).toHaveAttribute("aria-labelledby", id);
    expect(panel).toHaveAccessibleDescription("0");
    expect(panel.querySelector('[aria-live="polite"]')).toBeNull();
  });
  it("names the default figure with its summary and retains its content", () => {
    render(
      <InstrumentPanel
        label={{ accent: "Resources", meta: ["Host", null, "4 cores"] }}
        summary="Music storage uses 280 of 1000 GB."
        className="mt-8"
      >
        <span>280 / 1000 GB</span>
      </InstrumentPanel>,
    );

    const panel = screen.getByRole("figure", {
      name: "Music storage uses 280 of 1000 GB.",
    });
    expect(panel.tagName).toBe("FIGURE");
    expect(panel).toHaveClass("mt-8", "@container");
    expect(within(panel).getByText("280 / 1000 GB")).toBeInTheDocument();
    expect(within(panel).getByText("Resources")).toHaveClass(
      "text-accent-action-hi",
    );
    expect(panel).toHaveTextContent("Host · 4 cores");
  });

  it("starts with a quiet rule unless ruled is false", () => {
    const { rerender } = render(
      <InstrumentPanel label={{ children: "Levels" }} summary="Audio levels.">
        Levels
      </InstrumentPanel>,
    );
    expect(screen.getByRole("figure")).toHaveClass(
      "pt-5.5",
      "border-t",
      "border-border-quiet",
    );

    rerender(
      <InstrumentPanel
        label={{ children: "Levels" }}
        summary="Audio levels."
        ruled={false}
      >
        Levels
      </InstrumentPanel>,
    );
    expect(screen.getByRole("figure")).not.toHaveClass("border-t");
  });

  it.each([2, 3] as const)(
    "uses an h%i label while keeping technical metadata and status separate",
    (headingLevel) => {
      render(
        <InstrumentPanel
          label={{ children: "Analysis" }}
          headingLevel={headingLevel}
          meta={<span>Updated 12 seconds ago</span>}
          status={<StatusDot tone="on" label="Ready" />}
          summary="851 tracks analysed."
        >
          <span>851 tracks analysed</span>
        </InstrumentPanel>,
      );

      const panel = screen.getByRole("figure");
      const heading = within(panel).getByRole("heading", {
        level: headingLevel,
        name: "Analysis",
      });
      const technicalMeta = within(panel).getByText("Updated 12 seconds ago");
      const live = panel.querySelector('[aria-live="polite"]');
      expect(heading).toHaveClass("font-mono");
      expect(live).toHaveTextContent("Ready");
      expect(live).not.toContainElement(technicalMeta);
      expect(live).not.toContainElement(heading);
      expect(
        within(panel).getByText("851 tracks analysed"),
      ).toBeInTheDocument();
    },
  );

  it("renders a named section when its label is the section heading", () => {
    render(
      <InstrumentPanel
        as="section"
        label={{ children: "Playback" }}
        headingLevel={2}
      >
        <p>Player preferences.</p>
      </InstrumentPanel>,
    );

    const panel = screen.getByRole("region", { name: "Playback" });
    expect(panel.tagName).toBe("SECTION");
    expect(
      within(panel).getByRole("heading", { level: 2, name: "Playback" }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Player preferences.")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("keeps changing measurements outside the status announcement region", () => {
    const { rerender } = render(
      <InstrumentPanel
        label={{ children: "Levels" }}
        status="Running"
        meta="48 kHz"
      >
        <meter aria-label="Peak level" min={-60} max={0} value={-11.2}>
          −11.2 dB
        </meter>
      </InstrumentPanel>,
    );
    const panel = screen.getByRole("figure");
    const live = panel.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent(/^Running$/);
    expect(live).not.toContainElement(screen.getByLabelText("Peak level"));

    rerender(
      <InstrumentPanel
        label={{ children: "Levels" }}
        status="Running"
        meta="48 kHz"
      >
        <meter aria-label="Peak level" min={-60} max={0} value={-9.8}>
          −9.8 dB
        </meter>
      </InstrumentPanel>,
    );
    expect(screen.getByLabelText("Peak level")).toHaveTextContent("−9.8 dB");
    expect(live).toHaveTextContent(/^Running$/);
    expect(live).not.toHaveTextContent(/48 kHz|dB/);

    rerender(
      <InstrumentPanel
        label={{ children: "Levels" }}
        status="Stopped"
        meta="48 kHz"
      >
        <meter aria-label="Peak level" min={-60} max={0} value={-9.8}>
          −9.8 dB
        </meter>
      </InstrumentPanel>,
    );
    expect(panel.querySelector('[aria-live="polite"]')).toHaveTextContent(
      /^Stopped$/,
    );
  });
});
