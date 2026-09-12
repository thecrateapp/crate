import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  applyAppearanceToRoot,
  createDefaultAppearancePreferences,
  resolveAppearance,
} from "@crate/ui/lib/appearance-resolver";
import { SKIN_VARIABLE_ALLOWLIST } from "@crate/ui/lib/theme-skin";
import { ThemeScope } from "./ThemeScope";

const preview = resolveAppearance(
  {
    ...createDefaultAppearancePreferences(),
    mode: "light",
    preset: "crateRed",
    overrides: { accent: "violet", radius: "rounded" },
  },
  { prefersColorSchemeDark: false, prefersReducedMotion: false },
);

describe("ThemeScope", () => {
  it("applies an isolated preview without touching the app root or storage", () => {
    const appRoot = document.documentElement;
    appRoot.dataset.crateMode = "dark";
    appRoot.style.setProperty("--crate-token-color-primary", "#06b6d4");
    localStorage.setItem("crate.listen.appearance.v2", "original");

    const { unmount } = render(
      <ThemeScope appearance={preview} data-testid="preview">
        <span>Preview</span>
      </ThemeScope>,
    );

    const scope = screen.getByTestId("preview");
    expect(scope.dataset.crateMode).toBe("light");
    expect(scope.dataset.crateSkin).toBe("crateRed");
    expect(scope.style.getPropertyValue("--crate-token-color-primary")).toBe(
      "#7c3aed",
    );
    expect(appRoot.dataset.crateMode).toBe("dark");
    expect(appRoot.style.getPropertyValue("--crate-token-color-primary")).toBe(
      "#06b6d4",
    );
    expect(localStorage.getItem("crate.listen.appearance.v2")).toBe("original");

    unmount();
    expect(scope.isConnected).toBe(false);
    expect(appRoot.dataset.crateMode).toBe("dark");
  });

  it("restores only variables and attributes owned by the scope", () => {
    const root = document.createElement("div");
    root.dataset.crateMode = "dark";
    root.style.setProperty("--crate-token-color-primary", "external");
    root.style.setProperty("--unrelated-variable", "keep");
    document.body.appendChild(root);

    const cleanup = applyAppearanceToRoot(root, preview);
    expect(root.dataset.crateMode).toBe("light");
    expect(root.style.getPropertyValue("--unrelated-variable")).toBe("keep");

    cleanup();
    expect(root.dataset.crateMode).toBe("dark");
    expect(root.style.getPropertyValue("--crate-token-color-primary")).toBe(
      "external",
    );
    expect(root.style.getPropertyValue("--unrelated-variable")).toBe("keep");

    root.remove();
  });

  it("owns every skin variable instead of inheriting part of the preview", () => {
    render(
      <ThemeScope appearance={preview} data-testid="complete-preview">
        <span>Preview</span>
      </ThemeScope>,
    );

    const scope = screen.getByTestId("complete-preview");
    const missing = SKIN_VARIABLE_ALLOWLIST.filter(
      (name) => scope.style.getPropertyValue(name) === "",
    );

    expect(missing).toEqual([]);
  });
});
