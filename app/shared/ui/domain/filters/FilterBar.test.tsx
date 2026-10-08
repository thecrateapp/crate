import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FilterBar } from "./index";

describe("FilterBar", () => {
  it("renders search, sort, chips, leading and actions slots", () => {
    render(
      <FilterBar
        label="Filter liked tracks"
        chipsLabel="Genres"
        leading={<button type="button">Play all</button>}
        search={<input aria-label="Filter" />}
        sort={<button type="button">Sort</button>}
        actions={<button type="button">Reset</button>}
        chips={<button type="button">Rock</button>}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Filter liked tracks" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Genres" })).toContainElement(
      screen.getByRole("button", { name: "Rock" }),
    );
    expect(screen.getByRole("textbox", { name: "Filter" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play all" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("omits empty rows", () => {
    const { container } = render(
      <FilterBar chips={<button type="button">Live</button>} />,
    );

    expect(screen.getByTestId("filter-bar")).not.toHaveAttribute("role");
    expect(container.querySelector('[data-slot="filter-search"]')).toBeNull();
    expect(
      container.querySelector('[data-slot="filter-chips"]'),
    ).not.toBeNull();
  });
});
