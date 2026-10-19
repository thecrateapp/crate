import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SectionHeader } from "./SectionHeader";

it("keeps section context and zero subtitle/count visible with native heading naming", () => {
  render(
    <section aria-labelledby="album-heading">
      <SectionHeader
        id="album-heading"
        title="Albums"
        eyebrow="Collection"
        subtitle={0}
        count={0}
      />
    </section>,
  );
  expect(screen.getByText("Collection")).toBeVisible();
  expect(screen.getByRole("region", { name: "Albums" })).toBeVisible();
  expect(screen.getAllByText("0")).toHaveLength(2);
});
