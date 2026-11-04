import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AlbumReadings, type ReadingSeries } from "./AlbumReadings";

const tempo: ReadingSeries = {
  label: "Mean tempo",
  unit: "BPM",
  digits: 0,
  domain: [60, 200],
  values: [
    { label: "World In My Eyes", value: 81 },
    { label: "Sweetest Perfection", value: 68 },
    { label: "Halo", value: 112 },
  ],
};

const keys = [
  { key: "D minor", count: 2 },
  { key: "F major", count: 4 },
  { key: "A minor", count: 1 },
];

function reading(name: string) {
  return screen.getByText(name).closest('[data-slot="album-reading"]')!;
}

function strip(name: string) {
  return reading(name).querySelector('[data-slot="album-reading-strip"]');
}

describe("AlbumReadings", () => {
  it("shows each reading's mean beside its label", () => {
    render(<AlbumReadings readings={[tempo]} keys={keys} animate={false} />);

    expect(reading("Mean tempo")).toHaveTextContent("Mean tempo87 BPM");
  });

  it("marks every track on the strip with the mean glowing among them", () => {
    render(<AlbumReadings readings={[tempo]} keys={keys} animate={false} />);

    const marks = strip("Mean tempo")!.querySelectorAll(
      '[data-slot="album-reading-tick"]',
    );
    // 2% + 96% of the position on the 60–200 BPM library scale.
    expect([...marks].map((mark) => mark.getAttribute("x1"))).toEqual([
      "16.4%",
      "7.5%",
      "37.7%",
    ]);
    expect(
      strip("Mean tempo")!
        .querySelector('[data-slot="album-reading-mean"]')
        ?.getAttribute("x"),
    ).toBe("20.5%");
    const band = strip("Mean tempo")!.querySelector(
      '[data-slot="album-reading-range"]',
    );
    expect(band?.getAttribute("x")).toBe("7.5%");
    expect(band?.getAttribute("width")).toBe("30.2%");
  });

  it("keeps values outside the library scale on its edges", () => {
    render(
      <AlbumReadings
        readings={[
          {
            ...tempo,
            values: [{ value: 40 }, { value: 250 }],
          },
        ]}
        keys={[]}
        animate={false}
      />,
    );

    const marks = strip("Mean tempo")!.querySelectorAll(
      '[data-slot="album-reading-tick"]',
    );
    expect([...marks].map((mark) => mark.getAttribute("x1"))).toEqual([
      "2%",
      "98%",
    ]);
  });

  it("names the mean, the range and its tracks for screen readers and on hover", () => {
    render(<AlbumReadings readings={[tempo]} keys={keys} animate={false} />);

    expect(
      screen.getByRole("img", {
        name: "Mean tempo: 87 BPM, from 68 BPM (Sweetest Perfection) to 112 BPM (Halo)",
      }),
    ).toBeInTheDocument();
  });

  it("shows a single value without range or track marks", () => {
    render(
      <AlbumReadings
        readings={[
          { ...tempo, label: "Tempo", digits: 1, values: [{ value: 119.5 }] },
        ]}
        keys={[]}
        animate={false}
      />,
    );

    expect(reading("Tempo")).toHaveTextContent("119.5 BPM");
    expect(
      strip("Tempo")!.querySelectorAll('[data-slot="album-reading-tick"]'),
    ).toHaveLength(0);
    expect(
      strip("Tempo")!.querySelector('[data-slot="album-reading-range"]'),
    ).toBeNull();
    expect(
      screen.getByRole("img", { name: "Tempo: 119.5 BPM" }),
    ).toBeInTheDocument();
  });

  it("shows a dash and no strip when nothing was measured", () => {
    render(
      <AlbumReadings
        readings={[{ ...tempo, values: [] }]}
        keys={[]}
        animate={false}
      />,
    );

    expect(reading("Mean tempo")).toHaveTextContent("—");
    expect(strip("Mean tempo")).toBeNull();
    expect(reading("Most frequent key")).toHaveTextContent("—");
    expect(screen.queryByRole("list", { name: "Keys" })).toBeNull();
  });

  it("lists the album's keys by count with the most frequent first", () => {
    render(<AlbumReadings readings={[tempo]} keys={keys} animate={false} />);

    expect(reading("Most frequent key")).toHaveTextContent(
      /^Most frequent keyF major/,
    );
    const chips = within(
      screen.getByRole("list", { name: "Keys" }),
    ).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "F major ×4",
      "D minor ×2",
      "A minor ×1",
    ]);
    expect(chips[0]).toHaveAttribute("data-dominant", "true");
    expect(chips[1]).not.toHaveAttribute("data-dominant");
  });

  it("folds keys past the sixth into a count", () => {
    const many = ["C", "D", "E", "F", "G", "A", "B", "C#"].map(
      (note, index) => ({
        key: `${note} major`,
        count: 8 - index,
      }),
    );
    render(<AlbumReadings readings={[]} keys={many} animate={false} />);

    const chips = within(
      screen.getByRole("list", { name: "Keys" }),
    ).getAllByRole("listitem");
    expect(chips).toHaveLength(7);
    expect(chips[6]).toHaveTextContent("+2 more");
  });

  it("animates only when motion is allowed", () => {
    const { container, rerender } = render(
      <AlbumReadings readings={[tempo]} keys={keys} animate />,
    );
    const root = container.querySelector('[data-slot="album-readings"]');
    expect(root).toHaveAttribute("data-animated", "true");

    rerender(<AlbumReadings readings={[tempo]} keys={keys} animate={false} />);

    expect(root).toHaveAttribute("data-animated", "false");
  });
});
