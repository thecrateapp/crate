import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./confirm-dialog";

const TOKENS = resolve(process.cwd(), "../shared/ui/tokens");
const tokenCss = [
  ...readdirSync(TOKENS)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(resolve(TOKENS, name), "utf8")),
  // The admin entry registers the surface colors it uses (bg-card, ...).
  readFileSync(resolve(process.cwd(), "src/index.css"), "utf8"),
].join("\n");
const themeCss = [...tokenCss.matchAll(/@theme[^{]*\{([^}]*)\}/g)]
  .map((match) => match[1])
  .join("\n");

/** Whether a `bg-*` class has CSS behind it: a surface class or a theme color. */
function definesBackground(className: string) {
  const name = className.slice("bg-".length);
  return (
    new RegExp(`\\.${className}\\s*\\{`).test(tokenCss) ||
    new RegExp(`--color-${name}:`).test(themeCss)
  );
}

describe("ConfirmDialog", () => {
  it("renders title and description", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange when cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Over a Sheet the dialog must hide what is behind it. A `bg-*` class
  // that Tailwind never generates still replaces the base surface, so the
  // dialog would draw with no background at all.
  it("draws on the modal surface, a background the stylesheets define", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Discard?"
        description="The draft is cleared."
        variant="destructive"
        onConfirm={vi.fn()}
      />,
    );
    const content = screen.getByRole("alertdialog");
    const backgrounds = [...content.classList].filter((name) =>
      name.startsWith("bg-"),
    );
    expect(backgrounds).toEqual(["bg-modal-surface"]);
    expect(backgrounds.every(definesBackground)).toBe(true);
    expect(definesBackground("bg-not-a-surface")).toBe(false);
  });
});
