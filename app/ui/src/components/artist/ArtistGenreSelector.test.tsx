import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ArtistGenreSelector } from "./ArtistGenreSelector";

vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: {
      nodes: [
        {
          slug: "ambient",
          name: "Ambient",
          alias_names: [],
          parent_slugs: [],
          top_level: true,
        },
        {
          slug: "dark-ambient",
          name: "Dark ambient",
          alias_names: ["dark ambient"],
          parent_slugs: ["ambient"],
          top_level: false,
        },
      ],
    },
    loading: false,
    error: null,
  }),
}));

it("preserves canonical values while presenting the picker with shared checked controls", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ArtistGenreSelector value={["ambient"]} onChange={onChange} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Genres" }));
  expect(screen.getByRole("checkbox", { name: "Ambient" })).toHaveAttribute(
    "data-slot",
    "checkbox",
  );
  expect(screen.getByRole("checkbox", { name: "Ambient" })).toBeChecked();
  await userEvent.type(
    screen.getByPlaceholderText("Search taxonomy genres..."),
    "dark",
  );
  expect(
    screen.queryByRole("checkbox", { name: "Ambient" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "Dark ambient" }));
  expect(onChange).toHaveBeenCalledWith(["ambient", "dark-ambient"]);
  rerender(
    <ArtistGenreSelector
      value={["ambient", "dark-ambient"]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("checkbox", { name: "Dark ambient" })).toBeChecked();
});
