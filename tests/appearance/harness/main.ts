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
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import {
  getUiPreferences,
  initializeUiPreferences,
  setUiPreferences,
  subscribeUiPreferences,
  type UiPreferences,
} from "@crate/ui/lib/interface-preferences";

applyCrateIdentity();
const disposePreferences = initializeUiPreferences();
import.meta.hot?.dispose(disposePreferences);

const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);

let activePreferences = getUiPreferences();
let draftPreferences = { ...activePreferences };
let logoRoot: Root | undefined;
let heroRoot: Root | undefined;
let focusRoot: Root | undefined;
let heroArtworkMode: "clear" | "dark-extend" = "clear";

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
          <p class="eyebrow">Crate v3</p>
          <h1>Interface contract</h1>
          <p class="muted">Real identity tokens and functional preferences, isolated from production routes.</p>
        </div>
        <div class="status" aria-live="polite">
          <span data-testid="identity-status">Crate v3</span>
        </div>
      </header>
      <section class="controls" aria-label="Functional interface preferences">
        <label>Motion<select data-testid="motion-select">${optionMarkup(
          ["system", "reduced"],
          draftPreferences.motion,
        )}</select></label>
        <label>Effects<select data-testid="effects-select">${optionMarkup(
          ["off", "subtle", "expressive"],
          draftPreferences.effects,
        )}</select></label>
        <label>Density<select data-testid="density-select">${optionMarkup(
          ["comfortable", "compact"],
          draftPreferences.density,
        )}</select></label>
        <label>Hero artwork<select data-testid="hero-artwork-mode">
          ${optionMarkup(["clear", "dark-extend"], heroArtworkMode)}
        </select></label>
        <button type="button" data-testid="apply-button">Apply</button>
        <button type="button" data-testid="cancel-button">Cancel</button>
        <p role="alert" data-testid="preferences-error" hidden>Could not save interface preferences.</p>
      </section>
      <div class="scopes">
        <section data-testid="preview-scope" class="scope scope-primary">
          <p class="scope-label">Primary scope</p>
          <article data-testid="appearance-card" class="appearance-card">
            <p class="eyebrow">Preview card</p>
            <h2>Listen to your library</h2>
            <p class="muted">Surface, text and accent use the fixed Crate v3 identity.</p>
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
            <span data-testid="portal-content">Portal content inherits the Crate v3 identity.</span>
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
            <h2>Crate v3</h2>
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

function bindControls(): void {
  for (const key of ["motion", "effects", "density"] as const) {
    document.querySelector<HTMLSelectElement>(
      `[data-testid=${key}-select]`,
    )!.onchange = (event) => {
      draftPreferences = {
        ...draftPreferences,
        [key]: (event.target as HTMLSelectElement).value,
      } as UiPreferences;
    };
  }
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
    const saved = setUiPreferences(draftPreferences);
    document.querySelector<HTMLElement>(
      "[data-testid=preferences-error]",
    )!.hidden = saved;
    if (saved) {
      activePreferences = getUiPreferences();
      draftPreferences = { ...activePreferences };
      applyScopes();
    }
  };
  document.querySelector<HTMLButtonElement>(
    "[data-testid=cancel-button]",
  )!.onclick = () => {
    draftPreferences = { ...activePreferences };
    render();
  };
}

function applyScopes(): void {
  const reducedMotion =
    activePreferences.motion === "reduced" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const logoMount = document.querySelector<HTMLElement>(
    "[data-testid=logo-mount]",
  );
  if (logoMount) {
    logoRoot ??= createRoot(logoMount);
    logoRoot.render(
      createElement(CrateLogo, {
        "data-testid": "logo",
        effects: activePreferences.effects !== "off",
        reducedMotion,
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
    const metrics = CONTENT_DENSITY_METRICS[activePreferences.density];
    densityList.dataset.density = activePreferences.density;
    densityList
      .querySelector<HTMLElement>("[data-testid=density-anchor]")!
      .setAttribute("data-estimate", String(metrics.rowEstimate));
  }
}

const unsubscribePreferences = subscribeUiPreferences(() => {
  activePreferences = getUiPreferences();
  applyScopes();
});
const reducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
const refreshMotion = () => applyScopes();
reducedMotionQuery.addEventListener("change", refreshMotion);
import.meta.hot?.dispose(() => {
  unsubscribePreferences();
  reducedMotionQuery.removeEventListener("change", refreshMotion);
});

render();
