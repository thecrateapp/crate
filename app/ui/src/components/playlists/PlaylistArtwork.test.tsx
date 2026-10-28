import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaylistArtwork } from "./PlaylistArtwork";
describe("Admin playlist artwork content", () => {
  it("omits the decorative fallback in Admin while preserving its gradient and default Crate mark", () => {
    const { container } = render(<PlaylistArtwork name="Sin cubierta" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "playlist-artwork-placeholder",
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/logo.svg",
    );
  });
  it("preserves custom covers, canonical collage helpers and explicit mark visibility", () => {
    const { container, rerender } = render(
      <PlaylistArtwork
        name="Cover"
        coverDataUrl="data:image/png;base64,AA=="
        showCrateMark={false}
      />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")).toHaveAttribute("alt", "Cover");
    rerender(
      <PlaylistArtwork
        name="Collage"
        tracks={[{ artist: "Costa Norte", album: "Luz", album_id: 68 }]}
      />,
    );
    expect(
      container.querySelector('img[alt="Collage"]')?.getAttribute("src"),
    ).toContain("/api/");
    expect(container.querySelector('img[alt=""]')).toHaveAttribute(
      "src",
      "/assets/logo.svg",
    );
  });
});
