import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { ArtistDetailSection } from "./ArtistDetailSection";

describe("ArtistDetailSection", () => {
  it("keeps captions, actions and body in the same frame with or without controls", () => {
    render(
      <>
        <ArtistDetailSection title="Biography">
          Biography content
        </ArtistDetailSection>
        <ArtistDetailSection
          title="Probable Setlist"
          count={3}
          actions={<ActionButton label="Refresh setlist">Refresh</ActionButton>}
        >
          Setlist content
        </ArtistDetailSection>
      </>,
    );
    for (const name of ["Biography", "Probable Setlist"]) {
      const section = screen.getByRole("region", { name });
      expect(section).toHaveAttribute("data-slot", "artist-detail-section");
      expect(section).not.toHaveClass("border-t", "pt-5.5");
      expect(
        section.querySelector('[data-slot="artist-detail-header"]'),
      ).toHaveClass("min-h-11", "items-center", "mb-3");
      expect(within(section).getByRole("heading", { name })).toHaveClass(
        "crate-mono-label",
        "text-accent-action-hi",
      );
      expect(
        section.querySelector('[data-slot="artist-detail-body"]'),
      ).toBeTruthy();
    }
    expect(screen.getByText("3")).toHaveAttribute("data-slot", "info-badge");
    expect(
      within(
        screen.getByRole("region", { name: "Probable Setlist" }),
      ).getByRole("button", { name: "Refresh setlist" }),
    ).toBeInTheDocument();
  });

  it("adds a rule only when it is a subsequent section and associates helper copy", () => {
    render(
      <ArtistDetailSection
        title="Members"
        ruled
        description="Current and former members"
      >
        One member
      </ArtistDetailSection>,
    );
    const section = screen.getByRole("region", { name: "Members" });
    expect(section).toHaveClass("border-t", "pt-6");
    expect(section).toHaveAccessibleDescription("Current and former members");
    expect(within(section).getByText("One member")).toBeInTheDocument();
  });
});
