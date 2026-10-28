import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { SkipLink } from "./SkipLink";

it.each(["keyboard", "pointer"])(
  "moves focus into the content with %s, retaining the URL",
  async (input) => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink targetId="content">Skip to main content</SkipLink>
        <nav>
          <a href="/other">Navigation</a>
        </nav>
        <main id="content" tabIndex={-1}>
          <button type="button">Content action</button>
        </main>
      </>,
    );
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toHaveAttribute("href", "#content");
    const url = window.location.href;
    if (input === "keyboard") {
      await user.tab();
      expect(link).toHaveFocus();
      await user.keyboard("{Enter}");
    } else await user.click(link);
    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.href).toBe(url);
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Content action" }),
    ).toHaveFocus();
  },
);
