import "@testing-library/jest-dom/vitest";

import caCatalog from "@/i18n/catalogs/ca.json";
import deCatalog from "@/i18n/catalogs/de.json";
import enCatalog from "@/i18n/catalogs/en.json";
import esCatalog from "@/i18n/catalogs/es.json";
import euCatalog from "@/i18n/catalogs/eu.json";
import frCatalog from "@/i18n/catalogs/fr.json";
import itCatalog from "@/i18n/catalogs/it.json";
import type { ListenResources } from "@/i18n/I18nProvider";

type ListenTestGlobal = typeof globalThis & {
  __CRATE_LISTEN_TEST_I18N_RESOURCES__?: ListenResources;
};

(globalThis as ListenTestGlobal).__CRATE_LISTEN_TEST_I18N_RESOURCES__ = {
  ca: { translation: caCatalog },
  de: { translation: deCatalog },
  en: { translation: enCatalog },
  es: { translation: esCatalog },
  eu: { translation: euCatalog },
  fr: { translation: frCatalog },
  it: { translation: itCatalog },
};

/**
 * Vitest setup: polyfill localStorage. jsdom's implementation is
 * incomplete in some environments — replace with an in-memory map for
 * test isolation.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

// jsdom's window is a different context; patch it too in case some code
// reads window.localStorage directly.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: globalThis.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: globalThis.sessionStorage,
    writable: true,
    configurable: true,
  });

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
}

// Radix UI's pointer interactions use these APIs, which jsdom does not expose.
const pointerCapturePrototype = HTMLElement.prototype as HTMLElement & {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};
pointerCapturePrototype.hasPointerCapture ??= () => false;
pointerCapturePrototype.setPointerCapture ??= () => undefined;
pointerCapturePrototype.releasePointerCapture ??= () => undefined;
HTMLElement.prototype.scrollIntoView ??= () => undefined;
