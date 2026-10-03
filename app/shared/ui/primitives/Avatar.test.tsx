import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Avatar, getInitials } from "./Avatar";

describe("getInitials", () => {
  it("uses first and last word initials", () => {
    expect(getInitials("diego rin martín")).toBe("DM");
    expect(getInitials("  Birds   In Row ")).toBe("BR");
  });

  it("uses a single initial for one word", () => {
    expect(getInitials("admin")).toBe("A");
  });

  it("handles empty names and astral characters", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials(null)).toBe("?");
    expect(getInitials("😀 smile")).toBe("😀S");
  });
});

describe("Avatar", () => {
  it("renders the image with the name as alt", () => {
    render(<Avatar src="/a.jpg" name="High Vis" />);
    const image = screen.getByRole("img", { name: "High Vis" });
    expect(image).toHaveAttribute("src", "/a.jpg");
  });

  it("prefers an explicit alt", () => {
    render(<Avatar src="/a.jpg" name="High Vis" alt="" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back to initials without src", () => {
    render(<Avatar name="Rival Schools" />);
    expect(
      screen.getByRole("img", { name: "Rival Schools" }),
    ).toHaveTextContent("RS");
  });

  it("falls back to initials on image error", () => {
    const { container } = render(
      <Avatar src="/broken.jpg" name="Birds In Row" />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("BR")).toBeInTheDocument();
  });

  it("hides decorative fallbacks", () => {
    const { container } = render(<Avatar />);
    expect(
      container.querySelector("[data-slot='avatar-fallback']"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("applies size and shape", () => {
    const { container } = render(<Avatar name="A" size="xl" shape="rounded" />);
    const root = container.firstElementChild;
    expect(root).toHaveClass("size-20", "rounded-md");
    expect(root).toHaveAttribute("data-shape", "rounded");
  });

  it("defaults to a md circle", () => {
    const { container } = render(<Avatar name="A" />);
    expect(container.firstElementChild).toHaveClass("size-10", "rounded-full");
  });
});
