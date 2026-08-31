import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MapPin } from "@crate/ui/icons";

import { OpsPageHero } from "./OpsPageHero";
import { OpsPanel } from "./OpsPanel";
import { OpsStatTile } from "./OpsStatTile";

describe("stats surface shadows", () => {
  it("uses the semantic card shadow for the page hero", () => {
    render(
      <OpsPageHero
        icon={MapPin}
        title="Operations"
        description="System overview"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Operations" }).closest("section"),
    ).toHaveClass("shadow-card");
  });

  it("uses the semantic card shadow for panels", () => {
    render(
      <OpsPanel icon={MapPin} title="Details">
        Content
      </OpsPanel>,
    );

    expect(
      screen.getByRole("heading", { name: "Details" }).closest("section"),
    ).toHaveClass("shadow-card");
  });

  it("uses the semantic card shadow for stat tiles", () => {
    render(<OpsStatTile icon={MapPin} label="Shows" value="12" />);

    expect(screen.getByText("Shows").closest(".shadow-card")).toHaveClass(
      "shadow-card",
    );
  });
});
