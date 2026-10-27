import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtistHeroPresentation } from "./ArtistHeroPresentation";
describe("ArtistHeroPresentation", () => {
  it.each(["desktop", "mobile"] as const)(
    "keeps %s editorial geometry and gives contextual copy the MonoLabel role",
    (composition) => {
      render(
        <ArtistHeroPresentation
          composition={composition}
          kicker="Featured artist"
          artistName="Mixed Case Artist"
          actions={<button type="button">Play</button>}
          intro="Natural case introduction."
        />,
      );
      expect(screen.getByText("Featured artist")).toHaveClass(
        "font-mono",
        "uppercase",
      );
      expect(
        screen.getByRole("heading", { name: "Mixed Case Artist" }),
      ).not.toHaveClass("uppercase");
      expect(
        screen.getByRole("heading", { name: "Mixed Case Artist" }),
      ).toHaveClass("font-display", "-ml-[0.035em]");
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    },
  );
});
