import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { AdaptiveFeatureChips } from "./EqualizerAdaptiveReadouts";

describe("adaptive readout shared tags", () => {
  it("keeps all feature values and icons with the shared Mono 400 recipe", () => {
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
    for (const value of ["20%", "-25.0 LUFS", "16.0 dB", "80%"] as const) {
      const text = screen.getByText(value, { exact: true });
      expect(text).toHaveAttribute("title");
      expect(text.parentElement).toHaveClass(
        "font-mono",
        "font-normal",
        "leading-none",
      );
      expect(text.parentElement?.querySelector("svg")).not.toBeNull();
    }
  });
});
