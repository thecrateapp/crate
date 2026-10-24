import "@testing-library/jest-dom/vitest";

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
}

// jsdom has no ResizeObserver. Radix controls inside a <form> render a
// hidden native input that measures its control with one, so stub it.
if (typeof globalThis.ResizeObserver === "undefined") {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: TestResizeObserver,
    writable: true,
    configurable: true,
  });
}

// The shared Select uses Radix pointer capture and scroll focus APIs absent in jsdom.
import { installRadixElementPolyfills } from "./test/radix-element-polyfills";
installRadixElementPolyfills();

// Browser media-query hooks are used by the shared entity and action components.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }),
  });
}
