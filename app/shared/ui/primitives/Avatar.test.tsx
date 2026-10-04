import { describe, expect, it, vi } from "vitest";
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

  it("renders a custom image and falls back to initials when it errors", () => {
    const onImageError = vi.fn();
    const { container } = render(
      <Avatar
        src="/custom.jpg"
        name="Birds In Row"
        imageClassName="extra"
        renderImage={(image) => (
          <img
            data-testid="custom-image"
            src={image.src}
            alt={image.alt}
            className={image.className}
            onError={() => {
              image.onError();
              onImageError();
            }}
          />
        )}
      />,
    );
    const image = screen.getByTestId("custom-image");
    expect(image).toHaveAttribute("src", "/custom.jpg");
    expect(image).toHaveAttribute("alt", "Birds In Row");
    expect(image).toHaveClass("size-full", "object-cover", "extra");

    fireEvent.error(image);

    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("BR")).toBeInTheDocument();
  });

  it("shows a new src after the previous one errored", () => {
    const { container, rerender } = render(
      <Avatar src="/broken.jpg" name="Birds In Row" />,
    );
    fireEvent.error(container.querySelector("img")!);
    rerender(<Avatar src="/fallback.jpg" name="Birds In Row" />);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/fallback.jpg",
    );
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
