import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Disc, User } from "@crate/ui/icons";
import { MediaCover } from "./MediaCover";

describe("MediaCover", () => {
  it("renders image when src is provided", () => {
    const { getByTestId } = render(<MediaCover src="cover.jpg" alt="Cover" />);
    const image = getByTestId("media-cover-image");
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute("src", "cover.jpg");
    expect(image).toHaveAttribute("alt", "Cover");
  });

  it("renders fallback icon when src is missing", () => {
    const { getByTestId, queryByTestId } = render(<MediaCover />);
    expect(queryByTestId("media-cover-image")).not.toBeInTheDocument();
    expect(getByTestId("media-cover-fallback")).toBeInTheDocument();
  });

  it("renders custom fallback icon", () => {
    const { container, getByTestId } = render(
      <MediaCover fallbackIcon={Disc} />,
    );
    expect(getByTestId("media-cover-fallback")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("uses a dash when no initials or artwork are available", () => {
    const { container } = render(<MediaCover />);
    const svg = container.querySelector("svg");
    expect(svg).toBeNull();
    expect(container.textContent).toContain("—");
  });

  it("switches to fallback on image error", () => {
    const { getByTestId, queryByTestId } = render(
      <MediaCover src="broken.jpg" fallbackIcon={User} />,
    );
    const image = getByTestId("media-cover-image");
    fireEvent.error(image);
    expect(queryByTestId("media-cover-image")).not.toBeInTheDocument();
    expect(getByTestId("media-cover-fallback")).toBeInTheDocument();
  });

  it("uses fallbackUrl when the primary image fails", () => {
    const { getByTestId } = render(
      <MediaCover src="broken.jpg" fallbackUrl="fallback.jpg" />,
    );

    fireEvent.error(getByTestId("media-cover-image"));

    expect(getByTestId("media-cover-image")).toHaveAttribute(
      "src",
      "fallback.jpg",
    );
  });

  it("uses fallbackUrl when src is missing", () => {
    const { getByTestId } = render(<MediaCover fallbackUrl="fallback.jpg" />);

    expect(getByTestId("media-cover-image")).toHaveAttribute(
      "src",
      "fallback.jpg",
    );
  });

  it("applies square shape class by default", () => {
    const { getByTestId } = render(<MediaCover src="cover.jpg" />);
    expect(getByTestId("media-cover-image").parentElement).toHaveClass(
      "rounded-lg",
    );
  });

  it("applies circle shape class when requested", () => {
    const { getByTestId } = render(
      <MediaCover src="cover.jpg" shape="circle" />,
    );
    expect(getByTestId("media-cover-image").parentElement).toHaveClass(
      "rounded-full",
    );
  });

  it("applies rounded shape class when requested", () => {
    const { getByTestId } = render(
      <MediaCover src="cover.jpg" shape="rounded" />,
    );

    expect(getByTestId("media-cover-image").parentElement).toHaveClass(
      "rounded-2xl",
    );
  });
});

describe("MediaCover fallback", () => {
  it("renders a ReactNode fallback after an image error", () => {
    const { getByTestId, queryByTestId } = render(
      <MediaCover src="broken.jpg" fallback={<span data-testid="custom" />} />,
    );
    fireEvent.error(getByTestId("media-cover-image"));
    expect(queryByTestId("media-cover-image")).not.toBeInTheDocument();
    expect(getByTestId("custom")).toBeInTheDocument();
  });

  it("renders string fallbacks as initials text", () => {
    const { getByText, container } = render(<MediaCover fallback="AB" />);
    expect(getByText("AB")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("exposes alt on the fallback container", () => {
    const { getByRole } = render(<MediaCover alt="Album cover" />);
    expect(getByRole("img", { name: "Album cover" })).toBeInTheDocument();
  });

  it("resets the error when src changes", () => {
    const { getByTestId, rerender } = render(
      <MediaCover src="broken.jpg" fallback="X" />,
    );
    fireEvent.error(getByTestId("media-cover-image"));
    rerender(<MediaCover src="next.jpg" fallback="X" />);
    expect(getByTestId("media-cover-image")).toHaveAttribute("src", "next.jpg");
  });
});

it("uses technical initials and a shared inset hairline when artwork is absent", () => {
  const { getByRole, container } = render(
    <MediaCover alt="A Moon Shaped Pool" />,
  );
  expect(getByRole("img", { name: "A Moon Shaped Pool" })).toHaveTextContent(
    "AP",
  );
  expect(getByRole("img")).toHaveClass("crate-media-cover");
  expect(container.querySelector("svg")).toBeNull();
});

it("keeps the failed primary failed when only its fallback URL changes", () => {
  const view = render(
    <MediaCover src="bad.jpg" fallbackUrl="old.jpg" alt="Album" />,
  );
  fireEvent.error(view.getByTestId("media-cover-image"));
  view.rerender(<MediaCover src="bad.jpg" fallbackUrl="new.jpg" alt="Album" />);
  expect(view.getByRole("img", { name: "Album" })).toHaveAttribute(
    "src",
    "new.jpg",
  );
});

it("injects a managed image renderer with its shared fallback and forwards frame attributes", () => {
  const view = render(
    <MediaCover
      src="canonical.jpg"
      alt="Costa Norte"
      id="managed-cover"
      aria-describedby="cover-hint"
      renderImage={({ fallback, ...image }) => (
        <div data-testid="managed-image">
          {fallback}
          <img {...image} />
        </div>
      )}
    />,
  );
  expect(view.getByTestId("managed-image")).toBeInTheDocument();
  expect(view.container.querySelector("#managed-cover")).toHaveAttribute(
    "aria-describedby",
    "cover-hint",
  );
  expect(view.getByRole("img", { name: "Costa Norte" })).toHaveAttribute(
    "src",
    "canonical.jpg",
  );
  expect(view.getByTestId("managed-image")).toHaveTextContent("CN");
});

it.each([
  [48, "size-12"],
  [56, "size-14"],
  [88, "size-22"],
  ["fill", "size-full"],
] as const)("maps size %s to a fixed frame", (size, className) => {
  render(<MediaCover alt="Doolittle" size={size} />);
  const cover = screen.getByRole("img", { name: "Doolittle" });
  expect(cover).toHaveClass(className);
  expect(cover).toHaveAttribute("data-size", String(size));
  if (size === "fill") expect(cover).not.toHaveClass("shrink-0");
  else expect(cover).toHaveClass("shrink-0");
});

it("leaves sizing to the parent when no size is given", () => {
  render(<MediaCover alt="Doolittle" />);
  const cover = screen.getByRole("img", { name: "Doolittle" });
  expect(cover).not.toHaveAttribute("data-size");
  expect(cover.className).not.toMatch(/\bsize-/);
});
