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
