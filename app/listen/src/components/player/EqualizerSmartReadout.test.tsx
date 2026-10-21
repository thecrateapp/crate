import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EqualizerSmartReadout } from "@/components/player/EqualizerSmartReadout";
import type { EffectiveEq } from "@/hooks/use-effective-eq";
import deCatalog from "@/i18n/catalogs/de.json";
import enCatalog from "@/i18n/catalogs/en.json";
import esCatalog from "@/i18n/catalogs/es.json";
import euCatalog from "@/i18n/catalogs/eu.json";
import { SMART_EQ_SOURCE_LABEL_KEYS } from "@/lib/equalizer-labels";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const CATALOGS = {
  en: enCatalog,
  es: esCatalog,
  de: deCatalog,
  eu: euCatalog,
} as Record<"en" | "es" | "de" | "eu", Record<string, string>>;

const OVERFLOW_CLASS =
  /\b(truncate|whitespace-nowrap|overflow-hidden|text-ellipsis)\b/;

function smartEq(overrides: Partial<EffectiveEq> = {}): EffectiveEq {
  return {
    source: "genre_taxonomy_preset",
    label: "Genre",
    reasoning: "",
    genre: { slug: "thrash-metal", name: "Thrash metal" },
    inheritedFrom: null,
    ...overrides,
  } as unknown as EffectiveEq;
}

describe("EqualizerSmartReadout", () => {
  it.each(["en", "es", "de", "eu"] as const)(
    "renders only the confirmed Smart EQ source with its %s label",
    (locale) => {
      const { container } = renderWithListenProviders(
        <EqualizerSmartReadout eq={smartEq()} status="ready" />,
        { locale },
      );

      const labels = Array.from(
        container.querySelectorAll("[data-source]"),
        (node) => node.textContent?.trim(),
      );
      expect(labels).toEqual([
        CATALOGS[locale][SMART_EQ_SOURCE_LABEL_KEYS.genre_taxonomy_preset],
      ]);
    },
  );

  it.each(["de", "eu"] as const)(
    "lets the long %s chain wrap instead of clipping it",
    (locale) => {
      const { container } = renderWithListenProviders(
        <EqualizerSmartReadout eq={smartEq()} status="ready" />,
        { locale },
      );

      const sources = container.querySelectorAll<HTMLElement>("[data-source]");
      sources.forEach((node) => {
        expect(node).toHaveAttribute("title");
        expect(node).toHaveTextContent(
          CATALOGS[locale][SMART_EQ_SOURCE_LABEL_KEYS.genre_taxonomy_preset]!,
        );
      });
      for (
        let node: HTMLElement | null = sources[0]!.parentElement;
        node && node !== container;
        node = node.parentElement
      ) {
        expect(node.className).not.toMatch(OVERFLOW_CLASS);
      }
    },
  );

  it("names the genre an inherited preset comes from through the catalog", () => {
    renderWithListenProviders(
      <EqualizerSmartReadout
        eq={smartEq({
          inheritedFrom: { slug: "metal", name: "Metal" },
        } as unknown as Partial<EffectiveEq>)}
        status="ready"
      />,
      { locale: "es" },
    );

    expect(screen.getByText("de Metal")).toBeInTheDocument();
  });
});
