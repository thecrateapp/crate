import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoodRose, type MoodSeries } from "./MoodRose";

const tracks = ["Halo", "Clean", "Blue Dress"];

function series(mood: string, values: number[]): MoodSeries {
  return {
    mood,
    values: values.map((value, index) => ({ label: tracks[index], value })),
  };
}

// Given out of order on purpose: the rose always draws its moods in the same place.
const album: MoodSeries[] = [
  series("sad", [0.65, 0.64, 0.45]),
  series("electronic", [0.68, 0.09, 0.14]),
  series("happy", [0.46, 0.53, 0.45]),
  series("party", [0.46, 0.43, 0.55]),
  series("relaxed", [0.37, 0.39, 0.38]),
  series("acoustic", [0.01, 0.01, 0.03]),
  series("aggressive", [0.03, 0.05, 0.1]),
  series("dark", [0.01, 0.07, 0.14]),
];

function petals(container: HTMLElement) {
  return [...container.querySelectorAll('[data-slot="mood-rose-petal"]')];
}

function petal(container: HTMLElement, mood: string) {
  return petals(container).find(
    (entry) => entry.getAttribute("data-mood") === mood,
  )!;
}

describe("MoodRose", () => {
  it("draws one petal per mood in a fixed place around the rose", () => {
    const { container } = render(<MoodRose moods={album} animate={false} />);

    expect(
      petals(container).map((entry) => entry.getAttribute("data-mood")),
    ).toEqual([
      "party",
      "happy",
      "relaxed",
      "acoustic",
      "sad",
      "dark",
      "aggressive",
      "electronic",
    ]);
  });

  it("reaches each petal out to the album's mean on a 0–100% radius", () => {
    const { container } = render(<MoodRose moods={album} animate={false} />);

    // Mean 58% of a 100-unit radius.
    expect(
      petal(container, "sad")
        .querySelector('[data-slot="mood-rose-arc"]')
        ?.getAttribute("d"),
    ).toContain("A58,58");
  });

  it("marks every track on its mood's spoke for an album", () => {
    const { container } = render(<MoodRose moods={album} animate={false} />);

    expect(
      container.querySelectorAll('[data-slot="mood-rose-track"]'),
    ).toHaveLength(24);
  });

  it("draws a single track's moods without track marks", () => {
    const { container } = render(
      <MoodRose
        moods={[{ mood: "sad", values: [{ value: 0.6 }] }]}
        animate={false}
      />,
    );

    expect(petals(container)).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-slot="mood-rose-track"]'),
    ).toHaveLength(0);
  });

  it("names the moods from strongest to weakest for screen readers", () => {
    render(<MoodRose moods={album} animate={false} />);

    expect(
      screen.getByRole("img", {
        name: "Mood: sad 58%, party 48%, happy 48%, relaxed 38%, electronic 30%, dark 7%, aggressive 6%, acoustic 2%",
      }),
    ).toBeInTheDocument();
  });

  it("explains each petal's range and its tracks on hover", () => {
    const { container } = render(<MoodRose moods={album} animate={false} />);

    expect(petal(container, "sad").querySelector("title")?.textContent).toBe(
      "Sad: mean 58%, from 45% (Blue Dress) to 65% (Halo)",
    );
  });

  it("brings out the moods that reach 30% and keeps the rest quiet", () => {
    const { container } = render(<MoodRose moods={album} animate={false} />);

    const strong = [
      ...container.querySelectorAll('[data-slot="mood-rose-label"]'),
    ]
      .filter((label) => label.getAttribute("data-strong") === "true")
      .map((label) => label.getAttribute("data-mood"));
    expect(strong).toEqual(["party", "happy", "relaxed", "sad", "electronic"]);
  });

  it("animates only when motion is allowed", () => {
    const { container, rerender } = render(<MoodRose moods={album} animate />);
    const root = container.querySelector('[data-slot="mood-rose"]');
    expect(root).toHaveAttribute("data-animated", "true");

    rerender(<MoodRose moods={album} animate={false} />);

    expect(root).toHaveAttribute("data-animated", "false");
  });
});
