import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import { BackLink } from "./BackLink";
import { PageHeader } from "./PageHeader";

describe("BackLink", () => {
  it("renders a router link with the label when `to` is set", () => {
    render(
      <MemoryRouter>
        <BackLink to="/paths" label="Back to paths" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Back to paths" })).toHaveAttribute(
      "href",
      "/paths",
    );
  });

  it("renders a button that calls onClick when no destination is set", async () => {
    const onClick = vi.fn();
    render(<BackLink onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Back" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the label as accessible name in the icon variant", () => {
    render(<BackLink variant="icon" label="Volver" onClick={() => {}} />);

    const button = screen.getByRole("button", { name: "Volver" });
    expect(button).not.toHaveTextContent("Volver");
  });
});

describe("PageHeader", () => {
  it("renders an h1 with subtitle, eyebrow, back slot and actions", () => {
    render(
      <PageHeader
        id="page-title"
        eyebrow="Library"
        title="Crates"
        subtitle="Your collections"
        back={<button type="button">Back</button>}
        actions={<button type="button">New crate</button>}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Crates" });
    expect(heading).toHaveAttribute("id", "page-title");
    expect(screen.getByText("Your collections")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New crate" }),
    ).toBeInTheDocument();
  });

  it("applies the md title size", () => {
    render(<PageHeader title="Decade" size="md" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-2xl");
  });
});

it("keeps page identity, artwork and zero-valued metadata named while preserving footer content", () => {
  render(
    <PageHeader
      title="Crates"
      artwork={<img alt="Collection artwork" />}
      meta={0}
      aria-describedby="page-context"
    >
      <p id="page-context">Collection tools</p>
    </PageHeader>,
  );
  const header = screen.getByRole("banner", { name: "Crates" });
  expect(header).toContainElement(
    screen.getByRole("img", { name: "Collection artwork" }),
  );
  expect(header).toHaveAccessibleDescription("Collection tools");
  expect(screen.getByText("0")).toBeVisible();
  expect(screen.getByText("Collection tools")).toBeVisible();
});

it("preserves zero subtitles instead of treating numeric content as absent", () => {
  render(<PageHeader title="Pending" subtitle={0} />);
  expect(screen.getByText("0")).toBeVisible();
});

it("forwards native BackLink descriptions and preserves keyboard route navigation", async () => {
  render(
    <MemoryRouter>
      <p id="return-context">Return to the saved collection</p>
      <BackLink
        to="/collection?tab=playlists"
        label="Back to playlists"
        aria-describedby="return-context"
      />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Back to playlists" });
  expect(link).toHaveAccessibleDescription("Return to the saved collection");
  expect(link).toHaveAttribute("href", "/collection?tab=playlists");
  await userEvent.tab();
  expect(link).toHaveFocus();
});
