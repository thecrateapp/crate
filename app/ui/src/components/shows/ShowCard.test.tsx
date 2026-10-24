import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { ShowCard } from "./ShowCard";

it("composes the calendar preview with shared genre pills, metadata and discoverable actions", () => {
  render(
    <MemoryRouter>
      <ShowCard
        show={{
          type: "show",
          artist: "Band",
          artist_id: 7,
          artist_slug: "band",
          date: "2099-05-15",
          time: "20:00",
          venue: "Sala Norte",
          city: "Madrid",
          country: "Spain",
          url: "https://tickets.example/7",
          genres: ["post-punk", "darkwave"],
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Band" })).toBeVisible();
  expect(
    screen.getByText("post-punk").closest('[data-slot="chip"]'),
  ).toHaveClass("genre-pill");
  expect(screen.getByText(/Sala Norte/).closest(".font-mono")).toHaveClass(
    "font-mono",
  );
  expect(
    screen.getByRole("group", { name: "Show preview actions" }),
  ).toBeVisible();
  const artist = screen.getByRole("link", { name: "Open artist" });
  const tickets = screen.getByRole("link", { name: "Get tickets" });
  expect(artist).toHaveAttribute("href", "/artists/band");
  expect(tickets).toHaveAttribute("href", "https://tickets.example/7");
  expect(tickets).toHaveAttribute("target", "_blank");
  expect(tickets).not.toHaveAttribute("title");
  expect(tickets).toHaveAttribute("data-size", "icon-lg");
});
