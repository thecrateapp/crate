import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./sheet";

const recipes = readFileSync(
  resolve(process.cwd(), "tokens/recipes.css"),
  "utf8",
);

for (const [kind, Root, Content, Header, Title, Description, inset] of [
  [
    "dialog",
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    "3rem",
  ],
  [
    "sheet",
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    "4rem",
  ],
] as const) {
  describe(`${kind} close-button spacing`, () => {
    it.each([true, false])(
      "reserves title space only when its close button is shown: %s",
      (showCloseButton) => {
        render(
          <Root open>
            <Content showCloseButton={showCloseButton}>
              <Header>
                <Title>
                  A long library title that wraps across several lines
                </Title>
                <Description>Library settings</Description>
              </Header>
            </Content>
          </Root>,
        );

        const layer = screen.getByRole("dialog");
        expect(
          layer.querySelector(`[data-slot="${kind}-header"]`),
        ).toBeInTheDocument();
        if (showCloseButton) {
          expect(layer).toHaveAttribute("data-has-close", "true");
          expect(
            screen.getByRole("button", { name: "Close" }),
          ).toBeInTheDocument();
        } else {
          expect(layer).not.toHaveAttribute("data-has-close");
          expect(
            screen.queryByRole("button", { name: "Close" }),
          ).not.toBeInTheDocument();
        }
      },
    );

    it("uses a conditional shared header inset so long titles cannot overlap the corner close", () => {
      const selector = `.crate-overlay-panel[data-slot="${kind}-content"][data-has-close="true"]`;
      const rule = recipes.slice(recipes.indexOf(selector));
      expect(recipes).toContain(selector);
      expect(rule.slice(0, rule.indexOf("}") + 1)).toMatch(
        new RegExp(
          `>\\s*\\[data-slot="${kind}-header"\\]\\s*\\{\\s*padding-right:\\s*${inset};`,
        ),
      );
    });
  });
}
