import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrateLoader } from "./CrateLoader";

describe("CrateLoader", () => {
  it("renders the Crate animated loader with an accessible status", () => {
    const { container } = render(<CrateLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Music.");
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/loaders/crate-loader.webp",
    );
  });

  it("supports custom loading labels for screen readers", () => {
    render(<CrateLoader label="Loading artist." />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading artist.");
  });
});
