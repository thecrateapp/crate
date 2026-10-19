import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { MissingAlbumCard } from "./MissingAlbumCard";

it.each(["Album", "EP", "Single", "Compilation"])(
  "keeps %s as neutral release metadata",
  (type) => {
    render(
      <MemoryRouter>
        <MissingAlbumCard title="Sample" year="2026" type={type} />
      </MemoryRouter>,
    );
    expect(screen.getByText(type).closest(".crate-info-badge")).toHaveClass(
      "text-text-secondary",
    );
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      "/download?q=Sample",
    );
  },
);
