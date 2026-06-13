import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
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

  it("renders default Music icon when no fallback and no src", () => {
    const { container } = render(<MediaCover />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
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
