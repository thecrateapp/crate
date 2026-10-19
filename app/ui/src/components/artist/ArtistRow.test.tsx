import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { ArtistRow } from "./ArtistRow";
it("retains the same minimum-size frame and navigation when an artist photo falls back", () => {
  const open = vi.fn();
  render(
    <MemoryRouter>
      <ArtistRow
        name="Costa Norte"
        artistId={1}
        albums={2}
        tracks={12}
        total_size_mb={100}
        onClick={open}
      />
    </MemoryRouter>,
  );
  const image = screen.getByRole("img", { name: "Costa Norte" });
  const frame = image.parentElement!;
  expect(frame).toHaveClass("crate-media-thumbnail");
  fireEvent.error(image);
  expect(screen.queryByRole("img", { name: "Costa Norte" })).toBeNull();
  expect(frame).toContainElement(screen.getByText("C", { exact: true }));
  fireEvent.keyDown(screen.getByRole("link"), { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(1);
});
