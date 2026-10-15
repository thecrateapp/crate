import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  GenrePill,
  GenrePillRow,
  resolveGenrePercent,
  type GenreProfileItem,
} from "./GenrePill";

describe("resolveGenrePercent", () => {
  it.each<[GenreProfileItem, number | null]>([
    [{ name: "Rock", percent: 17.25, share: 0.9 }, 17.25],
    [{ name: "Rock", percent: 0, share: 0.9 }, 0],
    [{ name: "Rock", percent: 100, share: 0.4 }, 100],
    [{ name: "Rock", percent: 125 }, 125],
    [{ name: "Rock", share: 0.314 }, 31],
    [{ name: "Rock", share: 0 }, 0],
    [{ name: "Rock", share: 1 }, 100],
    [{ name: "Rock", share: 1.2 }, 120],
    [{ name: "Rock", percent: null, share: 0.42 }, 42],
    [{ name: "Rock", weight: 0.8 }, null],
    [{ name: "Rock", percent: null, share: null }, null],
  ])("resolves %j to %s without normalizing the profile", (item, expected) => {
    expect(resolveGenrePercent(item)).toBe(expected);
  });
});

describe("GenrePill", () => {
  it("keeps the remove action inside the pill container", () => {
    render(
      <GenrePill
        item={{ name: "Hardcore punk", slug: "hardcore-punk" }}
        onRemove={vi.fn()}
        removeLabel="Remove Hardcore punk"
      />,
    );

    const removeButton = screen.getByRole("button", {
      name: "Remove Hardcore punk",
    });
    expect(removeButton.closest(".genre-pill")).toHaveClass("rounded-full");
    expect(removeButton).toHaveClass(
      "min-h-8",
      "min-w-8",
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    );
  });

  it("uses chip typography with a tabular percentage instead of a nested badge", () => {
    render(<GenrePill item={{ name: "Hardcore punk", percent: 42 }} />);

    expect(screen.getByTitle("Hardcore punk · 42%")).toHaveClass(
      "font-mono",
      "text-label",
      "tracking-chip",
    );
    const percent = screen.getByText("42%");
    expect(percent).toHaveAttribute("data-slot", "genre-percent");
    expect(percent).toHaveClass("tabular-nums");
    expect(percent).not.toHaveClass("font-semibold");
    expect(percent.className).not.toContain("--active-bg-strong");
  });

  it("renders the name in primary text and keeps the percentage accented", () => {
    render(<GenrePill item={{ name: "Shoegaze", share: 0.314 }} />);

    const pill = screen.getByTitle("Shoegaze · 31%");
    expect(pill).toHaveAttribute("data-slot", "chip");
    expect(pill).toHaveClass("genre-pill", "rounded-full", "border");
    expect(pill.className).not.toContain("--active-text");
    expect(screen.getByText("31%")).toHaveClass("text-accent-action-hi");
  });

  it("renders a button when clickable", () => {
    const onClick = vi.fn();
    render(<GenrePill item={{ name: "Shoegaze" }} onClick={onClick} />);

    const button = screen.getByRole("button", { name: "shoegaze" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).toHaveClass(
      "genre-pill",
      "min-h-8",
      "pointer-coarse:min-h-11",
    );
  });

  it.each([0, 100])("keeps the %s%% boundary visible", (percent) => {
    render(<GenrePill item={{ name: "Rock", percent }} />);

    expect(screen.getByText(`${percent}%`)).toBeVisible();
  });

  it("does not turn a weight-only genre into a percentage or an action", () => {
    const { container } = render(
      <GenrePill item={{ name: "Ambient", weight: 0.84 }} />,
    );

    expect(screen.getByText("ambient")).toBeVisible();
    expect(container.querySelector('[data-slot="genre-percent"]')).toBeNull();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps source provenance in the tooltip without changing the percentage", () => {
    render(
      <GenrePill
        item={{
          name: "Shoegaze",
          source: "musicbrainz",
          percent: 37.5,
          share: 0.8,
        }}
      />,
    );

    expect(screen.getByTitle("Shoegaze · 37.5% · musicbrainz")).toBeVisible();
    expect(screen.getByText("37.5%")).toBeVisible();
  });

  it("includes provenance without inventing a percentage for a source-only genre", () => {
    render(<GenrePill item={{ name: "Ambient", source: "manual" }} />);

    expect(screen.getByTitle("Ambient · manual")).toBeVisible();
  });

  it("keeps genre navigation and removal as independent accessible buttons", () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <GenrePill
        item={{ name: "Shoegaze", percent: 31 }}
        onClick={onClick}
        onRemove={onRemove}
        removeLabel="Quitar Shoegaze"
      />,
    );

    const selectButton = screen.getByRole("button", { name: "shoegaze 31%" });
    const removeButton = screen.getByRole("button", {
      name: "Quitar Shoegaze",
    });
    expect(selectButton).toHaveAttribute("data-slot", "chip");
    expect(removeButton).toHaveAttribute("data-slot", "chip");
    expect(selectButton.querySelector("button")).toBeNull();
    expect(removeButton.querySelector("button")).toBeNull();
    expect(selectButton).not.toHaveAttribute("aria-pressed");
    expect(selectButton).toHaveClass("min-h-8", "pointer-coarse:min-h-11");

    fireEvent.click(selectButton);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback remove label when none is supplied", () => {
    const onRemove = vi.fn();
    render(<GenrePill item={{ name: "Ambient" }} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Ambient" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("preserves custom layout classes", () => {
    render(<GenrePill item={{ name: "Ambient" }} className="max-w-xs" />);

    expect(screen.getByTitle("Ambient")).toHaveClass("max-w-xs");
  });
});

describe("GenrePillRow", () => {
  const items: GenreProfileItem[] = Array.from({ length: 7 }, (_, index) => ({
    name: `Genre ${index + 1}`,
    slug: `genre-${index + 1}`,
    percent: 10 + index,
  }));

  it("renders no row for an empty profile", () => {
    const { container } = render(<GenrePillRow items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("preserves profile order and percentages while limiting the default to six", () => {
    const { container } = render(<GenrePillRow items={items} />);

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".genre-pill"),
        (pill) => pill.title,
      ),
    ).toEqual(
      items.slice(0, 6).map((item) => `${item.name} · ${item.percent}%`),
    );
    expect(screen.queryByText("genre 7")).not.toBeInTheDocument();
  });

  it("honors an explicit max and preserves row layout classes", () => {
    const { container } = render(
      <GenrePillRow items={items} max={2} className="mt-3" />,
    );

    expect(container.querySelectorAll(".genre-pill")).toHaveLength(2);
    expect(container.firstElementChild).toHaveClass("mt-3");
  });

  it("passes the original profile item to onSelect without changing its data", () => {
    const onSelect = vi.fn();
    const item: GenreProfileItem = {
      name: "Shoegaze",
      slug: "shoegaze",
      source: "manual",
      weight: 8,
      share: 0.314,
    };
    render(<GenrePillRow items={[item]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "shoegaze 31%" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(item);
    expect(onSelect.mock.calls[0][0]).toBe(item);
    expect(item).toEqual({
      name: "Shoegaze",
      slug: "shoegaze",
      source: "manual",
      weight: 8,
      share: 0.314,
    });
  });
});
