import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { AdaptiveFeatureChips } from "./EqualizerAdaptiveReadouts";

describe("adaptive readout shared tags", () => {
  it("uses one accent mono band with named feature values", () => {
    renderWithListenProviders(
      <div className="font-semibold leading-loose">
        <AdaptiveFeatureChips
          status="ready"
          features={{
            brightness: 0.2,
            loudness: -25,
            dynamicRange: 16,
            energy: 0.8,
            danceability: null,
            valence: null,
            acousticness: null,
            instrumentalness: null,
          }}
        />
      </div>,
    );
    expect(
      screen.getByRole("group", { name: "Track curves" }),
    ).not.toHaveTextContent("Audio analysis");
    for (const value of ["20%", "-25.0 LUFS", "16.0 dB", "80%"] as const) {
      const text = screen.getByText(value, { exact: true });
      expect(text.parentElement).not.toHaveAttribute("title");
      expect(text.closest('[data-slot="eq-curve-readout"]')).toHaveClass(
        "font-mono",
        "font-normal",
        "uppercase",
        "bg-accent-action/10",
      );
      expect(
        screen
          .getByRole("group", { name: "Track curves" })
          .querySelector("svg"),
      ).not.toBeNull();
    }
  });
});
