import { cleanup, screen, waitFor } from "@testing-library/react";
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
  it("offers only the three functional preferences through canonical Select fields", () => {
    renderWithListenProviders(<InterfacePreferencesSection />, {
      locale: "en",
    });

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    for (const [label, selected] of [
      ["Content density", "Comfortable"],
      ["Motion", "System"],
      ["Effects", "Subtle"],
    ] as const)
      expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(
        selected,
      );
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
    const density = screen.getByRole("combobox", { name: "Content density" });
    density.focus();
    await user.keyboard("{Enter}{End}{Enter}");

    await waitFor(() => expect(density).toHaveTextContent("Compact"));
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

    await user.click(screen.getByRole("combobox", { name: "Motion" }));
    await user.click(screen.getByRole("option", { name: "Reduce motion" }));
    expect(document.documentElement.dataset.crateMotion).toBe("reduced");

    await user.click(screen.getByRole("combobox", { name: "Effects" }));
    await user.click(screen.getByRole("option", { name: "Off" }));

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

    await user.click(screen.getByRole("combobox", { name: "Motion" }));
    await user.click(screen.getByRole("option", { name: "Reduce motion" }));

    const error = await screen.findByRole("alert");
    expect(error).not.toHaveTextContent("settings.interface.saveError");
    expect(error).not.toBeEmptyDOMElement();
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
    expect(getUiPreferences().motion).toBe("reduced");
    expect(screen.getByRole("combobox", { name: "Motion" })).toHaveTextContent(
      "Reduce motion",
    );

    save.mockRestore();
    await user.click(screen.getByRole("combobox", { name: "Effects" }));
    await user.click(screen.getByRole("option", { name: "Off" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)!),
    ).toMatchObject({
      motion: "reduced",
      effects: "off",
    });
  });
});
