import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UI_PREFERENCES_STORAGE_KEY,
  getUiPreferences,
  initializeUiPreferences,
} from "@crate/ui/lib/interface-preferences";
import { InterfacePreferencesSection } from "@/components/settings/InterfacePreferencesSection";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

let disposePreferences: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-crate-density");
  document.documentElement.removeAttribute("data-crate-motion");
  document.documentElement.removeAttribute("data-crate-effects");
  disposePreferences = initializeUiPreferences({
    root: document.documentElement,
    storage: localStorage,
    matchMedia: window.matchMedia.bind(window),
  });
});

afterEach(() => {
  cleanup();
  disposePreferences?.();
  disposePreferences = undefined;
  vi.restoreAllMocks();
});

describe("InterfacePreferencesSection", () => {
  it("offers only the three functional preferences through shared filter chips", () => {
    renderWithListenProviders(<InterfacePreferencesSection />, {
      locale: "en",
    });

    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    for (const [label, selected] of [
      ["Content density", "Comfortable"],
      ["Motion", "System"],
      ["Effects", "Subtle"],
    ]) {
      expect(
        within(screen.getByRole("radiogroup", { name: label })).getByRole(
          "radio",
          { name: selected },
        ),
      ).toBeChecked();
    }
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /apply/i }),
    ).not.toBeInTheDocument();
  });

  it("saves compact density immediately using the keyboard and only the functional key", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<InterfacePreferencesSection />, {
      locale: "en",
    });
    const setItem = vi.spyOn(localStorage, "setItem");
    const density = screen.getByRole("radiogroup", { name: "Content density" });
    within(density).getByRole("radio", { name: "Comfortable" }).focus();
    await user.keyboard("{End}");

    await waitFor(() =>
      expect(
        within(density).getByRole("radio", { name: "Compact" }),
      ).toBeChecked(),
    );
    expect(document.documentElement.dataset.crateDensity).toBe("compact");
    expect(getUiPreferences()).toEqual({
      version: 1,
      density: "compact",
      motion: "system",
      effects: "subtle",
    });
    expect(setItem).toHaveBeenCalled();
    expect(new Set(setItem.mock.calls.map(([key]) => key))).toEqual(
      new Set([UI_PREFERENCES_STORAGE_KEY]),
    );
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)!),
    ).toEqual(getUiPreferences());
  });

  it("applies motion and effects immediately without overwriting the other preferences", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<InterfacePreferencesSection />, {
      locale: "en",
    });

    await user.click(screen.getByRole("radio", { name: "Reduce motion" }));
    expect(document.documentElement.dataset.crateMotion).toBe("reduced");

    await user.click(screen.getByRole("radio", { name: "Off" }));

    expect(document.documentElement.dataset.crateEffects).toBe("off");
    expect(getUiPreferences()).toEqual({
      version: 1,
      density: "comfortable",
      motion: "reduced",
      effects: "off",
    });
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)!),
    ).toEqual(getUiPreferences());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports persistence failure inline while retaining the selected preference and legacy data", async () => {
    const legacyKey = "crate.listen.appearance.v2";
    const legacy = JSON.stringify({
      version: 2,
      mode: "light",
      preset: "crateRed",
      presentation: { density: "compact" },
      accessibility: { motion: "reduced" },
      overrides: { effects: "off", accent: "violet" },
    });
    localStorage.setItem(legacyKey, legacy);
    const save = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const user = userEvent.setup();
    renderWithListenProviders(<InterfacePreferencesSection />, {
      locale: "en",
    });

    await user.click(screen.getByRole("radio", { name: "Reduce motion" }));

    const error = await screen.findByRole("alert");
    expect(error).not.toHaveTextContent("settings.interface.saveError");
    expect(error).not.toBeEmptyDOMElement();
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
    expect(getUiPreferences().motion).toBe("reduced");
    expect(screen.getByRole("radio", { name: "Reduce motion" })).toBeChecked();

    save.mockRestore();
    await user.click(screen.getByRole("radio", { name: "Off" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)!),
    ).toMatchObject({
      motion: "reduced",
      effects: "off",
    });
  });
});
