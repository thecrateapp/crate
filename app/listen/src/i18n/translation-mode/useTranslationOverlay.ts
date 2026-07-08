import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  extractTranslationMarker,
  stripTranslationMarker,
  type TranslationMarker,
} from "@/i18n/translation-mode/markers";

interface TranslationOverlayTarget {
  key: string;
  locale: string;
  sourceValue: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface TranslationOverlayHit {
  marker: TranslationMarker;
  rect: DOMRect;
}

function isTranslationModeAvailable() {
  return import.meta.env.DEV && import.meta.env.VITE_TRANSLATION_MODE === "1";
}

function targetElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

function markerHitFromElement(
  element: HTMLElement,
): TranslationOverlayHit | null {
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    if (current.closest("[data-translation-overlay]")) {
      return null;
    }

    const marker = extractTranslationMarker(current.textContent ?? "");
    if (marker) {
      return {
        marker,
        rect: current.getBoundingClientRect(),
      };
    }
    current = current.parentElement;
  }

  return null;
}

export function useTranslationOverlay() {
  const { i18n } = useTranslation();
  const available = isTranslationModeAvailable();
  const [active, setActive] = useState(false);
  const [hoveredHit, setHoveredHit] = useState<TranslationOverlayHit | null>(
    null,
  );
  const [selectedMarker, setSelectedMarker] =
    useState<TranslationMarker | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const localeForMarker = useCallback(
    (marker: TranslationMarker) =>
      marker.locale ?? i18n.resolvedLanguage ?? i18n.language ?? "en",
    [i18n.language, i18n.resolvedLanguage],
  );

  const valueFor = useCallback(
    (key: string, locale: string) =>
      stripTranslationMarker(i18n.t(key, { lng: locale })),
    [i18n],
  );

  const selectedTarget = useMemo<TranslationOverlayTarget | null>(() => {
    if (!selectedMarker) return null;
    const locale = localeForMarker(selectedMarker);
    return {
      key: selectedMarker.key,
      locale,
      sourceValue: valueFor(selectedMarker.key, "en"),
    };
  }, [localeForMarker, selectedMarker, valueFor]);

  useEffect(() => {
    if (!available) {
      setActive(false);
      setHoveredHit(null);
      setSelectedMarker(null);
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.ctrlKey &&
        event.altKey &&
        event.key.toLocaleLowerCase() === "t"
      ) {
        event.preventDefault();
        setActive((current) => !current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [available]);

  useEffect(() => {
    if (!active) {
      setHoveredHit(null);
      setSelectedMarker(null);
      return;
    }

    function handleMouseOver(event: MouseEvent) {
      const element = targetElement(event.target);
      setHoveredHit(element ? markerHitFromElement(element) : null);
    }

    function handleClick(event: MouseEvent) {
      const element = targetElement(event.target);
      const hit = element ? markerHitFromElement(element) : null;
      if (!hit) return;

      event.preventDefault();
      event.stopPropagation();
      const locale = localeForMarker(hit.marker);
      setSelectedMarker(hit.marker);
      setDraftValue(valueFor(hit.marker.key, locale));
      setSaveStatus("idle");
    }

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [active, localeForMarker, valueFor]);

  const closeEditor = useCallback(() => {
    setSelectedMarker(null);
    setDraftValue("");
    setSaveStatus("idle");
  }, []);

  const saveSelected = useCallback(async () => {
    if (!selectedTarget) return;

    setSaveStatus("saving");
    try {
      const response = await fetch(
        `/__crate_i18n/catalogs/${encodeURIComponent(selectedTarget.locale)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: selectedTarget.key,
            value: draftValue,
            markReviewed: true,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Catalog save failed: ${response.status}`);
      }

      const currentBundle = i18n.getResourceBundle(
        selectedTarget.locale,
        "translation",
      );
      i18n.addResourceBundle(
        selectedTarget.locale,
        "translation",
        {
          ...(typeof currentBundle === "object" && currentBundle !== null
            ? currentBundle
            : {}),
          [selectedTarget.key]: draftValue,
        },
        false,
        true,
      );
      setSaveStatus("saved");
    } catch (error) {
      console.error(error);
      setSaveStatus("error");
    }
  }, [draftValue, i18n, selectedTarget]);

  return {
    active,
    available,
    hoveredMarker: hoveredHit?.marker ?? null,
    hoveredRect: hoveredHit?.rect ?? null,
    selectedTarget,
    draftValue,
    saveStatus,
    setDraftValue,
    closeEditor,
    saveSelected,
  };
}
