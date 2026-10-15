import "@crate/ui/tokens/index.css";
import "./harness.css";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import {
  ArtistHeroFrame,
  type ArtistHeroArtworkBounds,
} from "@crate/ui/domain/ArtistHeroFrame";
import { ArtistHeroPresentation } from "@crate/ui/domain/ArtistHeroPresentation";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { CONTENT_DENSITY_METRICS } from "@crate/ui/lib/content-density";
import {
  applyAppearanceToRoot,
  inspectAppearancePreferences,
  resolveAppearance,
  writeAppearancePreferences,
} from "@crate/ui/lib/appearance-resolver";
import type {
  AppearanceOverrides,
  AppearancePreferencesV2,
  AppearanceResolution,
  ColorModePreference,
  Material,
  MotionPreference,
  PresetId,
} from "@crate/ui/lib/appearance-types";

const defaultPreferences: AppearancePreferencesV2 = {
  version: 2,
  mode: "dark",
  preset: "default",
  overrides: {},
  presentation: { density: "comfortable" },
  accessibility: { motion: "system" },
};

const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);

let activePreferences = readPreferences();
let draftPreferences = clonePreferences(activePreferences);
let primaryCleanup: (() => void) | undefined;
let secondaryCleanup: (() => void) | undefined;
let mediaCleanup: (() => void) | undefined;
let logoRoot: Root | undefined;
let heroRoot: Root | undefined;
let focusRoot: Root | undefined;
let heroArtworkMode: "clear" | "dark-extend" = "clear";

function clonePreferences(
  value: AppearancePreferencesV2,
): AppearancePreferencesV2 {
  return JSON.parse(JSON.stringify(value)) as AppearancePreferencesV2;
}

function readPreferences(): AppearancePreferencesV2 {
  const result = inspectAppearancePreferences(window.localStorage);
  return result.status === "valid" ? result.preferences : defaultPreferences;
}

function environment() {
  return {
    prefersColorSchemeDark: window.matchMedia("(prefers-color-scheme: dark)")
      .matches,
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
  };
}

function resolve(preferences: AppearancePreferencesV2): AppearanceResolution {
  return resolveAppearance(preferences, environment());
}

function optionMarkup(options: string[], selected: string): string {
  return options
    .map(
      (option) =>
        `<option value="${option}"${
          option === selected ? " selected" : ""
        }>${option}</option>`,
    )
    .join("");
}

function render(): void {
  logoRoot?.unmount();
  logoRoot = undefined;
  heroRoot?.unmount();
  heroRoot = undefined;
  focusRoot?.unmount();
  focusRoot = undefined;
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = `
    <section class="harness-shell" aria-label="Appearance contract harness">
      <header class="harness-header">
        <div>
          <p class="eyebrow">Crate appearance</p>
          <h1>Theme preview</h1>
          <p class="muted">Real token CSS and appearance resolver, isolated from production routes.</p>
        </div>
        <div class="status" aria-live="polite">
          <span data-testid="theme-mode"></span>
          <span data-testid="theme-skin"></span>
        </div>
      </header>
      <section class="controls" aria-label="Appearance controls">
        <label>Mode<select data-testid="mode-select">${optionMarkup(
          ["dark", "light", "system"],
          draftPreferences.mode,
        )}</select></label>
        <label>Preset<select data-testid="preset-select">${optionMarkup(
          ["default", "crateRed"],
          draftPreferences.preset,
        )}</select></label>
        <label>Material<select data-testid="material-select">${optionMarkup(
          ["glass", "solid"],
          draftPreferences.overrides.material ?? "glass",
        )}</select></label>
        <label>Motion<select data-testid="motion-select">${optionMarkup(
          ["system", "reduced"],
          draftPreferences.accessibility.motion,
        )}</select></label>
        <label>Accent<select data-testid="accent-select">${optionMarkup(
          ["theme", "cyan", "red", "violet"],
          draftPreferences.overrides.accent ?? "theme",
        )}</select></label>
        <label>Surface tone<select data-testid="surface-tone-select">${optionMarkup(
          ["theme", "neutral", "warm", "tinted"],
          draftPreferences.overrides.surfaceTone ?? "theme",
        )}</select></label>
        <label>Radius<select data-testid="radius-select">${optionMarkup(
          ["theme", "subtle", "rounded"],
          draftPreferences.overrides.radius ?? "theme",
        )}</select></label>
        <label>Typography<select data-testid="typography-select">${optionMarkup(
          ["theme", "brand", "system"],
          draftPreferences.overrides.typography ?? "theme",
        )}</select></label>
        <label>Effects<select data-testid="effects-select">${optionMarkup(
          ["theme", "off", "subtle", "expressive"],
          draftPreferences.overrides.effects ?? "theme",
        )}</select></label>
        <label>Density<select data-testid="density-select">${optionMarkup(
          ["comfortable", "compact"],
          draftPreferences.presentation.density,
        )}</select></label>
        <label>Hero artwork<select data-testid="hero-artwork-mode">
          ${optionMarkup(["clear", "dark-extend"], heroArtworkMode)}
        </select></label>
        <button type="button" data-testid="apply-button">Apply</button>
        <button type="button" data-testid="cancel-button">Cancel</button>
        <button type="button" data-testid="reset-button">Reset overrides</button>
      </section>
      <div class="scopes">
        <section data-testid="preview-scope" class="scope scope-primary">
          <p class="scope-label">Primary scope</p>
          <article data-testid="appearance-card" class="appearance-card">
            <p class="eyebrow">Preview card</p>
            <h2>Listen to your library</h2>
            <p class="muted">Surface, text, accent and radius come from the active appearance.</p>
            <button type="button" data-testid="accent-button" class="accent-button">Play artist</button>
          </article>
          <div data-testid="logo-mount" class="logo-mount"></div>
          <div data-testid="density-list" class="density-list">
            <span data-testid="density-anchor"></span>
            <div class="density-row">
              <span>Library track</span>
              <button type="button" class="density-action">Play</button>
            </div>
            <div class="density-row">
              <span>Another track</span>
              <button type="button" class="density-action">Play</button>
            </div>
          </div>
          <div data-testid="hero-mount" class="hero-mount"></div>
          <div data-testid="portal-target" class="portal-target">
            <span data-testid="portal-content">Portal content remains in the primary scope.</span>
          </div>
      <section aria-label="Keyboard focus contract" class="scope">
        <h2>Keyboard focus</h2>
        <div data-testid="focus-components"></div>
        <button type="button" data-testid="focus-utility" class="outline-none focus-visible:outline-none">Layered utility</button>
        <button type="button" data-testid="focus-menu" role="menuitem" class="crate-focus-inset">Menu row</button>
        <button type="button" data-testid="focus-jam" class="jam-card-interactive">Jam card</button>
        <input aria-label="Jam input" data-testid="focus-jam-input" class="jam-input" />
        <input aria-label="Radio input" data-testid="focus-radio-input" class="radio-seed-input" />
        <button type="button" data-testid="focus-signal" class="stats-signal-tape">Stats signal</button>
        <a href="#focus" data-testid="focus-link" class="link-meta link-inset">Truncating link</a>
        <p data-testid="selection-text">Selected Crate text</p>
      </section>
        </section>
        <section data-testid="secondary-scope" class="scope scope-secondary">
          <p class="scope-label">Secondary scope</p>
          <article class="appearance-card">
            <p class="eyebrow">Unchanged scope</p>
            <h2>Default dark</h2>
          </article>
        </section>
      </div>

    </section>
  `;

  focusRoot = createRoot(root.querySelector("[data-testid=focus-components]")!);
  focusRoot.render(
    createElement(
      "div",
      { className: "focus-controls" },
      createElement(Button, { "data-testid": "focus-cta" }, "Primary action"),
      createElement(
        Button,
        { variant: "outline", "data-testid": "focus-default" },
        "Secondary action",
      ),
      createElement(
        IconButton,
        { label: "Focus icon", "data-testid": "focus-icon" },
        "Icon",
      ),
      createElement(PlayButton, { "data-testid": "focus-play" }),
      createElement(Switch, {
        "aria-label": "Focus switch",
        "data-testid": "focus-switch",
      }),
      createElement(Checkbox, {
        "aria-label": "Focus checkbox",
        "data-testid": "focus-checkbox",
      }),
      createElement(
        RadioGroup,
        { "aria-label": "Focus quality", defaultValue: "high" },
        createElement(RadioGroupItem, {
          value: "high",
          "aria-label": "High",
          "data-testid": "focus-radio",
        }),
      ),
      createElement(Input, {
        "aria-label": "Focus input",
        "data-testid": "focus-input",
      }),
      createElement(
        Select,
        { defaultValue: "albums" },
        createElement(
          SelectTrigger,
          {
            "aria-label": "Focus collection",
            "data-testid": "focus-select-trigger",
          },
          createElement(SelectValue),
        ),
        createElement(
          SelectContent,
          null,
          createElement(SelectItem, { value: "albums" }, "Albums"),
          createElement(SelectItem, { value: "artists" }, "Artists"),
        ),
      ),
      createElement(
        HairlineList,
        { label: "Focus tracks" },
        createElement(
          HairlineRow,
          { asChild: true },
          createElement(
            "button",
            { type: "button", "data-testid": "focus-row" },
            "Track row",
          ),
        ),
      ),
      createElement(GenrePill, {
        item: { name: "Post-rock", percent: 64 },
        onClick() {},
        onRemove() {},
        removeLabel: "Remove focus genre",
      }),
    ),
  );

  bindControls();
  applyScopes();
}

function setDraft<K extends keyof AppearancePreferencesV2>(
  key: K,
  value: AppearancePreferencesV2[K],
): void {
  draftPreferences = { ...draftPreferences, [key]: value };
}

function setOverride<K extends keyof AppearanceOverrides>(
  key: K,
  value: string,
): void {
  const overrides = { ...draftPreferences.overrides };
  if (value === "theme") delete overrides[key];
  else overrides[key] = value as AppearanceOverrides[K];
  draftPreferences = { ...draftPreferences, overrides };
}

function bindControls(): void {
  document.querySelector<HTMLSelectElement>(
    "[data-testid=mode-select]",
  )!.onchange = (event) => {
    setDraft(
      "mode",
      (event.target as HTMLSelectElement).value as ColorModePreference,
    );
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=preset-select]",
  )!.onchange = (event) => {
    setDraft("preset", (event.target as HTMLSelectElement).value as PresetId);
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=material-select]",
  )!.onchange = (event) => {
    const material = (event.target as HTMLSelectElement).value as Material;
    draftPreferences = {
      ...draftPreferences,
      overrides: { ...draftPreferences.overrides, material },
    };
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=motion-select]",
  )!.onchange = (event) => {
    const motion = (event.target as HTMLSelectElement)
      .value as MotionPreference;
    draftPreferences = { ...draftPreferences, accessibility: { motion } };
  };
  const overrideSelectors = [
    ["accent", "accent"],
    ["surfaceTone", "surface-tone"],
    ["radius", "radius"],
    ["typography", "typography"],
    ["effects", "effects"],
  ] as const;
  for (const [key, testId] of overrideSelectors) {
    document.querySelector<HTMLSelectElement>(
      `[data-testid=${testId}-select]`,
    )!.onchange = (event) => {
      setOverride(key, (event.target as HTMLSelectElement).value);
    };
  }
  document.querySelector<HTMLSelectElement>(
    "[data-testid=density-select]",
  )!.onchange = (event) => {
    draftPreferences = {
      ...draftPreferences,
      presentation: {
        density: (event.target as HTMLSelectElement)
          .value as AppearancePreferencesV2["presentation"]["density"],
      },
    };
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=hero-artwork-mode]",
  )!.onchange = (event) => {
    heroArtworkMode = (event.target as HTMLSelectElement).value as
      | "clear"
      | "dark-extend";
    applyScopes();
  };
  document.querySelector<HTMLButtonElement>(
    "[data-testid=apply-button]",
  )!.onclick = () => {
    const result = writeAppearancePreferences(
      window.localStorage,
      draftPreferences,
    );
    if (result.v2Saved) {
      activePreferences = clonePreferences(draftPreferences);
      applyScopes();
    }
  };
  document.querySelector<HTMLButtonElement>(
    "[data-testid=cancel-button]",
  )!.onclick = () => {
    draftPreferences = clonePreferences(activePreferences);
    render();
  };
  document.querySelector<HTMLButtonElement>(
    "[data-testid=reset-button]",
  )!.onclick = () => {
    draftPreferences = { ...draftPreferences, overrides: {} };
    render();
  };
}

function applyScopes(): void {
  const primary = document.querySelector<HTMLElement>(
    "[data-testid=preview-scope]",
  )!;
  const secondary = document.querySelector<HTMLElement>(
    "[data-testid=secondary-scope]",
  )!;
  primaryCleanup?.();
  secondaryCleanup?.();
  const primaryAppearance = resolve(activePreferences);
  const secondaryAppearance = resolve(defaultPreferences);
  primaryCleanup = applyAppearanceToRoot(primary, primaryAppearance);
  secondaryCleanup = applyAppearanceToRoot(secondary, secondaryAppearance);

  document.documentElement.style.background = "var(--surface-canvas)";
  document.body.style.background = "var(--surface-canvas)";
  document.querySelector<HTMLElement>("[data-testid=theme-mode]")!.textContent =
    primaryAppearance.mode;
  document.querySelector<HTMLElement>("[data-testid=theme-skin]")!.textContent =
    primaryAppearance.preset;
  const logoMount = document.querySelector<HTMLElement>(
    "[data-testid=logo-mount]",
  );
  if (logoMount) {
    logoRoot ??= createRoot(logoMount);
    logoRoot.render(
      createElement(CrateLogo, {
        "data-testid": "logo",
        effects: primaryAppearance.effective.effects !== "off",
        reducedMotion: primaryAppearance.reducedMotion,
        size: 64,
        title: "Crate",
      }),
    );
  }

  const heroMount = document.querySelector<HTMLElement>(
    "[data-testid=hero-mount]",
  );
  if (heroMount) {
    const bounds: ArtistHeroArtworkBounds = {
      left: 0.12,
      top: 0,
      right: 0.88,
      bottom: 0.82,
    };
    const usesExtendedArtwork = heroArtworkMode === "dark-extend";
    const artworkClassName = usesExtendedArtwork
      ? "absolute inset-0 size-full object-fill"
      : "absolute inset-0 size-full object-cover object-center";
    const artwork = (composition: "desktop" | "mobile") =>
      createElement("img", {
        alt: "",
        className: artworkClassName,
        "data-testid": `${composition}-hero-artwork`,
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='32'%3E%3Crect width='64' height='32' fill='%2360a5fa'/%3E%3Ccircle cx='18' cy='16' r='11' fill='%23f8fafc'/%3E%3C/svg%3E",
      });
    const heroCopy = createElement(ArtistHeroPresentation, {
      composition: "desktop",
      kicker: "Just landed",
      artistName: "Quicksand",
      intro: createElement("p", null, "Your music, ready to explore"),
      genres: createElement("span", null, "post-hardcore"),
      actions: createElement(
        "button",
        { type: "button", className: "hero-action" },
        "Play artist",
      ),
    });
    const mobileCopy = createElement(ArtistHeroPresentation, {
      composition: "mobile",
      kicker: "Just landed",
      artistName: "Quicksand",
      genres: createElement("span", null, "post-hardcore"),
      actions: createElement(
        "button",
        { type: "button", className: "hero-action" },
        "Play artist",
      ),
    });
    heroRoot ??= createRoot(heroMount);
    heroRoot.render(
      createElement(
        "div",
        { className: "hero-pair" },
        createElement(
          ArtistHeroFrame,
          {
            composition: "desktop",
            artwork: artwork("desktop"),
            artworkBounds: usesExtendedArtwork ? bounds : undefined,
            aspectRatio: "1480 / 600",
            "data-artwork": heroArtworkMode,
            "data-bounds": usesExtendedArtwork
              ? `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`
              : undefined,
            "data-fit": usesExtendedArtwork
              ? "object-fill"
              : "object-cover object-center",
            className: "hero-preview hero-preview-desktop",
          },
          heroCopy,
        ),
        createElement(
          ArtistHeroFrame,
          {
            composition: "mobile",
            artwork: artwork("mobile"),
            aspectRatio: "4 / 5",
            "data-artwork": heroArtworkMode,
            "data-fit": usesExtendedArtwork
              ? "object-fill"
              : "object-cover object-center",
            className: "hero-preview hero-preview-mobile",
          },
          mobileCopy,
        ),
      ),
    );
  }

  const densityList = document.querySelector<HTMLElement>(
    "[data-testid=density-list]",
  );
  if (densityList) {
    const metrics = CONTENT_DENSITY_METRICS[primaryAppearance.density];
    densityList.dataset.density = primaryAppearance.density;
    densityList
      .querySelector<HTMLElement>("[data-testid=density-anchor]")!
      .setAttribute("data-estimate", String(metrics.rowEstimate));
  }

  mediaCleanup?.();
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMediaChange = () => {
    if (activePreferences.mode === "system") applyScopes();
  };
  media.addEventListener("change", onMediaChange);
  mediaCleanup = () => media.removeEventListener("change", onMediaChange);
}

render();
