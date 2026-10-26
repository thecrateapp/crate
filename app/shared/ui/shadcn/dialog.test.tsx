import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";

function dialog(size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl") {
  render(
    <Dialog open>
      <DialogContent size={size}>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Body</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole("dialog");
}

describe("DialogContent size", () => {
  it("defaults to the medium overlay width", () => {
    expect(dialog()).toHaveAttribute("data-overlay-size", "md");
  });

  it.each(["sm", "lg", "2xl", "3xl"] as const)(
    "maps size %s to the shared overlay recipe",
    (size) => {
      expect(dialog(size)).toHaveAttribute("data-overlay-size", size);
    },
  );
});
