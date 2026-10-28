import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UI_PREFERENCES_STORAGE_KEY,
  getUiPreferences,
  initializeUiPreferences,
  migrateUiPreferences,
  normalizeUiPreferences,
  readUiPreferences,
  setUiPreferences,
  subscribeUiPreferences,
} from "./interface-preferences";

const LEGACY_KEYS = [
  "crate.listen.appearance.v2",
  "crate.listen.theme-skin",
  "crate.listen.theme-skin.backup.v1",
  "crate.listen.appearance.corrupt-backup",
] as const;
const DEFAULTS = {
  version: 1,
  density: "comfortable",
  motion: "system",
  effects: "subtle",
} as const;

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const operations: string[] = [];
  const storage: Storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      operations.push(`set:${key}`);
      values.set(key, value);
    },
    removeItem: (key) => {
      operations.push(`remove:${key}`);
      values.delete(key);
    },
  };
  return { values, operations, storage };
}

function legacyPreferences(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 2,
    mode: "light",
    preset: "crateRed",
    overrides: { accent: "violet", material: "glass", effects: "off" },
    presentation: { density: "compact" },
    accessibility: { motion: "reduced" },
    ...overrides,
  });
}

function createMediaQuery(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener),
  } as unknown as MediaQueryList;
  return {
    query,
    change(next: boolean) {
      Object.defineProperty(query, "matches", {
        value: next,
        configurable: true,
      });
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});
beforeEach(() => {
  cleanups.push(
    initializeUiPreferences({
      root: document.createElement("div"),
      storage: createStorage().storage,
      matchMedia: () => createMediaQuery(false).query,
    }),
  );
});

describe("interface preferences migration", () => {
  it("normalizes only functional preferences and discards visual settings", () => {
    expect(
      normalizeUiPreferences({
        version: 1,
        density: "compact",
        motion: "reduced",
        effects: "off",
        mode: "light",
        preset: "crateRed",
        overrides: { accent: "red" },
      }),
    ).toEqual({
      version: 1,
      density: "compact",
      motion: "reduced",
      effects: "off",
    });
  });

  it.each([
    undefined,
    null,
    [],
    "compact",
    { density: "tiny", motion: "off", effects: "high" },
  ])("uses safe defaults for invalid functional preferences: %j", (value) => {
    expect(normalizeUiPreferences(value)).toEqual(DEFAULTS);
  });

  it("prefers a current functional store over legacy appearance", () => {
    const { storage } = createStorage({
      [UI_PREFERENCES_STORAGE_KEY]: JSON.stringify({
        ...DEFAULTS,
        effects: "expressive",
      }),
      [LEGACY_KEYS[0]]: legacyPreferences(),
    });
    expect(readUiPreferences(storage)).toEqual({
      ...DEFAULTS,
      effects: "expressive",
    });
  });

  it.each([undefined, "{broken", JSON.stringify({ version: 0 })])(
    "extracts functional values from v2 if the current store is unavailable: %s",
    (raw) => {
      const { storage, operations } = createStorage({
        ...(raw === undefined ? {} : { [UI_PREFERENCES_STORAGE_KEY]: raw }),
        [LEGACY_KEYS[0]]: legacyPreferences(),
      });
      expect(readUiPreferences(storage)).toEqual({
        version: 1,
        density: "compact",
        motion: "reduced",
        effects: "off",
      });
      expect(operations).toEqual([]);
    },
  );

  it.each(["dark", "light", "system"])(
    "discards legacy visual mode %s while retaining safety preferences",
    (mode) => {
      const { storage } = createStorage({
        [LEGACY_KEYS[0]]: legacyPreferences({ mode }),
      });
      expect(migrateUiPreferences(storage)).toEqual({
        version: 1,
        density: "compact",
        motion: "reduced",
        effects: "off",
      });
    },
  );

  it("writes the functional destination before removing only inventoried legacy keys", () => {
    const initial = Object.fromEntries(
      LEGACY_KEYS.map((key) => [
        key,
        key === LEGACY_KEYS[0] ? legacyPreferences() : "legacy backup",
      ]),
    );
    const { storage, values, operations } = createStorage({
      ...initial,
      "crate.locale": "es",
      "crate.listen.volume": "0.6",
    });
    const result = migrateUiPreferences(storage);
    expect(JSON.parse(values.get(UI_PREFERENCES_STORAGE_KEY)!)).toEqual(result);
    expect(operations[0]).toBe(`set:${UI_PREFERENCES_STORAGE_KEY}`);
    expect(LEGACY_KEYS.every((key) => !values.has(key))).toBe(true);
    expect(values.get("crate.locale")).toBe("es");
    expect(values.get("crate.listen.volume")).toBe("0.6");
    const count = operations.length;
    expect(migrateUiPreferences(storage)).toEqual(result);
    expect(operations).toHaveLength(count);
  });

  it("retains every source key if the destination cannot be written", () => {
    const source = legacyPreferences();
    const { storage, values } = createStorage({
      [LEGACY_KEYS[0]]: source,
      [LEGACY_KEYS[1]]: "legacy",
    });
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(migrateUiPreferences(storage).density).toBe("compact");
    expect(values.get(LEGACY_KEYS[0])).toBe(source);
    expect(values.get(LEGACY_KEYS[1])).toBe("legacy");
    expect(values.has(UI_PREFERENCES_STORAGE_KEY)).toBe(false);
  });

  it("preserves the persisted destination if legacy cleanup fails and retries safely", () => {
    const source = legacyPreferences();
    const { storage, values } = createStorage({ [LEGACY_KEYS[0]]: source });
    const removeItem = storage.removeItem;
    storage.removeItem = () => {
      throw new Error("blocked");
    };
    const result = migrateUiPreferences(storage);
    expect(values.get(LEGACY_KEYS[0])).toBe(source);
    expect(JSON.parse(values.get(UI_PREFERENCES_STORAGE_KEY)!)).toEqual(result);
    storage.removeItem = removeItem;
    expect(migrateUiPreferences(storage)).toEqual(result);
    expect(values.has(LEGACY_KEYS[0])).toBe(false);
  });

  it("never overwrites a future primary store or cleans legacy keys behind it", () => {
    const future = JSON.stringify({
      version: 2,
      density: "compact",
      future: true,
    });
    const { storage, values, operations } = createStorage({
      [UI_PREFERENCES_STORAGE_KEY]: future,
      [LEGACY_KEYS[0]]: legacyPreferences(),
    });
    expect(migrateUiPreferences(storage)).toEqual(DEFAULTS);
    expect(values.get(UI_PREFERENCES_STORAGE_KEY)).toBe(future);
    expect(values.has(LEGACY_KEYS[0])).toBe(true);
    expect(operations).toEqual([]);
  });

  it("preserves future legacy appearance and its backups when using the independent store", () => {
    const source = legacyPreferences({ version: 3 });
    const initial = {
      [LEGACY_KEYS[0]]: source,
      [LEGACY_KEYS[2]]: "backup",
      [LEGACY_KEYS[3]]: "corrupt backup",
    };
    const { storage, values } = createStorage(initial);
    expect(migrateUiPreferences(storage)).toEqual(DEFAULTS);
    for (const [key, value] of Object.entries(initial))
      expect(values.get(key)).toBe(value);
    expect(JSON.parse(values.get(UI_PREFERENCES_STORAGE_KEY)!)).toEqual(
      DEFAULTS,
    );
  });

  it.each([
    "{broken",
    JSON.stringify({
      version: 2,
      presentation: null,
      accessibility: [],
      overrides: { effects: "unknown" },
    }),
  ])("uses defaults for unusable legacy payloads: %s", (raw) => {
    expect(
      readUiPreferences(createStorage({ [LEGACY_KEYS[0]]: raw }).storage),
    ).toEqual(DEFAULTS);
  });

  it("tolerates inaccessible storage without a browser startup failure", () => {
    const { storage } = createStorage();
    storage.getItem = () => {
      throw new Error("blocked");
    };
    expect(readUiPreferences(storage)).toEqual(DEFAULTS);
    expect(migrateUiPreferences(storage)).toEqual(DEFAULTS);
  });
});

describe("interface preferences runtime", () => {
  it("applies only functional attributes and keeps a stable snapshot until preferences change", () => {
    const root = document.createElement("div");
    const { storage } = createStorage({
      [LEGACY_KEYS[0]]: legacyPreferences(),
    });
    cleanups.push(
      initializeUiPreferences({
        root,
        storage,
        matchMedia: () => createMediaQuery(false).query,
      }),
    );
    expect(root.dataset).toMatchObject({
      crateDensity: "compact",
      crateMotion: "reduced",
      crateEffects: "off",
    });
    expect(
      [...root.attributes].map((attribute) => attribute.name).sort(),
    ).toEqual([
      "data-crate-density",
      "data-crate-effects",
      "data-crate-motion",
    ]);
    expect(getUiPreferences()).toBe(getUiPreferences());
    const previous = getUiPreferences();
    expect(setUiPreferences({ density: "comfortable" })).toBe(true);
    expect(getUiPreferences()).not.toBe(previous);
    const unchanged = getUiPreferences();
    setUiPreferences({ density: "comfortable" });
    expect(getUiPreferences()).toBe(unchanged);
  });

  it("honours OS reduced motion and removes media and storage listeners on cleanup", () => {
    const media = createMediaQuery(true);
    const root = document.createElement("div");
    const { storage } = createStorage();
    const matchMedia = vi.fn((_query: string) => media.query);
    const cleanup = initializeUiPreferences({ root, storage, matchMedia });
    cleanups.push(cleanup);
    expect(matchMedia.mock.calls.map(([query]) => query)).toEqual([
      "(prefers-reduced-motion: reduce)",
    ]);
    expect(getUiPreferences().motion).toBe("system");
    expect(root.dataset.crateMotion).toBe("reduced");
    media.change(false);
    expect(root.dataset.crateMotion).toBe("system");
    setUiPreferences({ motion: "reduced" });
    media.change(false);
    expect(root.dataset.crateMotion).toBe("reduced");
    cleanup();
    expect(media.listenerCount()).toBe(0);
    storage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULTS, motion: "system" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: UI_PREFERENCES_STORAGE_KEY }),
    );
    expect(root.dataset.crateMotion).toBe("reduced");
  });

  it("updates memory and subscribers even when persistence fails", () => {
    const { storage } = createStorage();
    const root = document.createElement("div");
    cleanups.push(
      initializeUiPreferences({
        root,
        storage,
        matchMedia: () => createMediaQuery(false).query,
      }),
    );
    storage.setItem = () => {
      throw new Error("quota");
    };
    const listener = vi.fn();
    const unsubscribe = subscribeUiPreferences(listener);
    cleanups.push(unsubscribe);
    expect(setUiPreferences({ effects: "off" })).toBe(false);
    expect(getUiPreferences().effects).toBe("off");
    expect(root.dataset.crateEffects).toBe("off");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setUiPreferences({ effects: "expressive" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("updates runtime preferences without replacing a future primary payload", () => {
    const future = JSON.stringify({ version: 9, future: true });
    const { storage, values } = createStorage({
      [UI_PREFERENCES_STORAGE_KEY]: future,
      [LEGACY_KEYS[0]]: legacyPreferences(),
    });
    cleanups.push(
      initializeUiPreferences({
        root: document.createElement("div"),
        storage,
        matchMedia: () => createMediaQuery(false).query,
      }),
    );
    expect(setUiPreferences({ density: "compact" })).toBe(false);
    expect(getUiPreferences().density).toBe("compact");
    expect(values.get(UI_PREFERENCES_STORAGE_KEY)).toBe(future);
    expect(values.has(LEGACY_KEYS[0])).toBe(true);
  });

  it("reacts to cross-tab functional storage changes and ignores unrelated storage", () => {
    const root = document.createElement("div");
    const { storage } = createStorage();
    cleanups.push(
      initializeUiPreferences({
        root,
        storage,
        matchMedia: () => createMediaQuery(false).query,
      }),
    );
    const listener = vi.fn();
    cleanups.push(subscribeUiPreferences(listener));
    storage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULTS, density: "compact" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "crate.locale" }));
    expect(root.dataset.crateDensity).toBe("comfortable");
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(
      new StorageEvent("storage", { key: UI_PREFERENCES_STORAGE_KEY }),
    );
    expect(root.dataset.crateDensity).toBe("compact");
    expect(listener).toHaveBeenCalledTimes(1);
    storage.removeItem(UI_PREFERENCES_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(root.dataset.crateDensity).toBe("comfortable");
  });
});
