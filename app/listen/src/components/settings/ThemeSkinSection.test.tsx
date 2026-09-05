import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeSkinSection } from "@/components/settings/ThemeSkinSection";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("ThemeSkinSection", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-crate-skin");
  });

  it("shows the stored skin and applies a new skin selection", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });

    const defaultSkin = screen.getByRole("radio", { name: /Default/i });
    const auroraSkin = screen.getByRole("radio", { name: /Aurora/i });
    expect(defaultSkin).toHaveAttribute("aria-checked", "true");
    expect(auroraSkin).toHaveAttribute("aria-checked", "false");

    await user.click(auroraSkin);

    expect(auroraSkin).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.crateSkin).toBe("aurora");
    expect(localStorage.getItem("crate.listen.theme-skin")).toBe(
      JSON.stringify({ theme: "dark", skin: "aurora" }),
    );
  });

  it("initializes from the persisted skin", () => {
    localStorage.setItem(
      "crate.listen.theme-skin",
      JSON.stringify({ theme: "dark", skin: "aurora" }),
    );

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });

    expect(screen.getByRole("radio", { name: /Aurora/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
