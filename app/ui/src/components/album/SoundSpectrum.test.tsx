import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SoundSpectrum, type SpectrumFeature } from "./SoundSpectrum";

const album: SpectrumFeature[] = [
  {
    label: "Danceability",
    values: [
      { label: "World In My Eyes", value: 0.61 },
      { label: "Sweetest Perfection", value: 0.36 },
      { label: "Policy of Truth", value: 0.63 },
      { label: "Clean", value: 0.37 },
    ],
  },
  {
    label: "Energy",
    values: [
      { label: "World In My Eyes", value: 0.64 },
      { label: "Sweetest Perfection", value: 0.6 },
      { label: "Policy of Truth", value: 0.64 },
      { label: "Clean", value: 0.61 },
    ],
  },
];

function rows(container: HTMLElement) {
  return [...container.querySelectorAll('[data-slot="sound-spectrum-row"]')];
}

describe("SoundSpectrum", () => {
  it("draws one row per feature with its mean", () => {
    render(<SoundSpectrum features={album} animate={false} />);

    const list = screen.getByRole("list", { name: "Sound features" });
    const items = within(list).getAllByRole("listitem");
    expect(
      items.map(
        (item) =>
          item.querySelector('[data-slot="sound-spectrum-label"]')?.textContent,
      ),
    ).toEqual(["Danceability", "Energy"]);
    expect(
      items.map(
        (item) =>
          item.querySelector('[data-slot="sound-spectrum-value"]')?.textContent,
      ),
    ).toEqual(["49%", "62%"]);
  });

  it("fills each row up to its mean", () => {
    const { container } = render(
      <SoundSpectrum features={album} animate={false} />,
    );

    expect(
      rows(container).map((row) =>
        row
          .querySelector('[data-slot="sound-spectrum-fill"]')
          ?.getAttribute("width"),
      ),
    ).toEqual(["49.25", "62.25"]);
  });

  it("marks every track and draws a density ridge for an album", () => {
    const { container } = render(
      <SoundSpectrum features={album} animate={false} />,
    );

    for (const row of rows(container)) {
      expect(
        row.querySelectorAll('[data-slot="sound-spectrum-tick"]'),
      ).toHaveLength(4);
      expect(
        row.querySelector('[data-slot="sound-spectrum-ridge"]'),
      ).not.toBeNull();
    }
  });

  it("shows a single track's value without ridge or track marks", () => {
    const { container } = render(
      <SoundSpectrum
        features={[{ label: "Energy", values: [{ value: 0.7 }] }]}
        animate={false}
      />,
    );

    const [row] = rows(container);
    expect(
      row?.querySelector('[data-slot="sound-spectrum-value"]')?.textContent,
    ).toBe("70%");
    expect(row?.querySelector('[data-slot="sound-spectrum-ridge"]')).toBeNull();
    expect(
      row?.querySelectorAll('[data-slot="sound-spectrum-tick"]'),
    ).toHaveLength(0);
    expect(
      row?.querySelector('[data-slot="sound-spectrum-mean"]'),
    ).not.toBeNull();
  });

  it("names the range and its tracks for screen readers and on hover", () => {
    render(<SoundSpectrum features={album} animate={false} />);

    expect(
      screen.getByRole("img", {
        name: "Danceability: mean 49%, from 36% (Sweetest Perfection) to 63% (Policy of Truth)",
      }),
    ).toBeInTheDocument();
  });

  it("animates only when motion is allowed", () => {
    const { container, rerender } = render(
      <SoundSpectrum features={album} animate />,
    );
    const root = container.querySelector('[data-slot="sound-spectrum"]');
    expect(root).toHaveAttribute("data-animated", "true");

    rerender(<SoundSpectrum features={album} animate={false} />);

    expect(root).toHaveAttribute("data-animated", "false");
  });
});
