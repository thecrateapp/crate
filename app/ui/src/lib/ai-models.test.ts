import { describe, expect, it } from "vitest";

import {
  aiSnapshot,
  catalog,
  migratedSnapshot,
  PROFILE_ID,
  STUDIO_ID,
  usageFixture,
} from "@/components/ai-models/test-fixtures";
import type {
  Action,
  AssignmentOutcome,
  Config,
  Snapshot,
} from "@/components/ai-models/types";
import {
  activeFeatureCount,
  aiErrorText,
  configSummary,
  connectionName,
  dailyTokenBudget,
  dailyUsageSeries,
  FEATURE_AREAS,
  featureAreaLabel,
  featureModelView,
  featureSends,
  formatCount,
  formatDuration,
  formatTokens,
  imageDetailLabel,
  invocationStatusView,
  isUsableConnection,
  outcomeGroups,
  providerLabel,
  providerStatus,
  reasonText,
  reasoningLabel,
  reasoningPresets,
  splitConnections,
  summaryModel,
  usageToday,
} from "./ai-models";

function action(id: string, description = "fallback description"): Action {
  return {
    id,
    label: id,
    group: "shows",
    input: "text",
    permission: "curation.shows.write",
    location: "/upcoming",
    description,
    maxima: {
      timeout_seconds: 45,
      max_output_tokens: 4096,
      max_input_tokens: 131072,
      max_image_pixels: null,
      max_proposals: null,
      max_selected: null,
    },
  };
}

describe("FEATURE_AREAS / featureAreaLabel", () => {
  it("orders the known feature areas", () => {
    expect(FEATURE_AREAS).toEqual([
      "shows",
      "artwork",
      "editorial",
      "genres",
      "discovery",
      "translation",
    ]);
  });

  it("labels each known group", () => {
    expect(featureAreaLabel("shows")).toBe("Shows");
    expect(featureAreaLabel("artwork")).toBe("Artwork");
    expect(featureAreaLabel("editorial")).toBe("Editorial");
    expect(featureAreaLabel("genres")).toBe("Genres");
    expect(featureAreaLabel("discovery")).toBe("Discovery");
    expect(featureAreaLabel("translation")).toBe("Translations");
  });

  it("falls back to humanizeKey for unknown groups", () => {
    expect(featureAreaLabel("custom_group")).toBe("Custom group");
  });
});

describe("featureSends", () => {
  const cases: [string, string][] = [
    ["shows.extract.vision", "Sends: the poster or screenshot"],
    ["shows.extract.text", "Sends: pasted text or the text of a public page"],
    [
      "shows.extract.ocr_text",
      "Sends: text read by local OCR, never the image",
    ],
    ["artwork.hero.analyze", "Sends: the artist photo"],
    ["artists.bio.research", "Sends: collected sources and evidence"],
    [
      "genres.description.generate",
      "Sends: the genre, its context and seed artists",
    ],
    [
      "genres.taxonomy.propose",
      "Sends: genres and their current relationships",
    ],
    ["genres.eq.propose", "Sends: the genre and its context"],
    [
      "playlists.description.generate",
      "Sends: playlist rules and up to 60 tracks",
    ],
    [
      "music_paths.refine",
      "Sends: the computed path and the allowed alternatives",
    ],
    [
      "i18n.listen.draft",
      "Sends: interface text with its keys and placeholders",
    ],
  ];

  it.each(cases)("maps %s", (id, expected) => {
    expect(featureSends(action(id))).toBe(expected);
  });

  it("falls back to the action description for unknown actions", () => {
    expect(featureSends(action("unknown.action", "Custom description"))).toBe(
      "Custom description",
    );
  });
});

describe("providerLabel", () => {
  it("labels known providers", () => {
    expect(providerLabel("gemini")).toBe("Gemini");
    expect(providerLabel("deepseek")).toBe("DeepSeek");
    expect(providerLabel("ollama")).toBe("Ollama");
  });

  it("falls back to humanizeKey for other providers", () => {
    expect(providerLabel("lmstudio")).toBe("Lmstudio");
  });
});

describe("connectionName", () => {
  it("names environment connections after their provider", () => {
    const connection = aiSnapshot().connections.find(
      (c) => c.id === "env:gemini",
    )!;
    expect(connectionName(connection)).toBe("Gemini from server");
  });

  it("uses the stored label otherwise", () => {
    const connection = aiSnapshot().connections.find(
      (c) => c.source === "stored",
    )!;
    expect(connectionName(connection)).toBe("Studio");
  });
});

describe("providerStatus", () => {
  const base = aiSnapshot().connections.find((c) => c.source === "stored")!;

  it("reports turned off first", () => {
    expect(providerStatus({ ...base, enabled: false })).toEqual({
      label: "Turned off",
      tone: "neutral",
    });
  });

  it("reports needs key for non-ollama providers without a key", () => {
    expect(providerStatus({ ...base, has_key: false })).toEqual({
      label: "Needs key",
      tone: "warning",
    });
  });

  it("does not require a key for ollama", () => {
    expect(
      providerStatus({
        ...base,
        provider: "ollama",
        has_key: false,
        catalog_status: "ready",
      }),
    ).toEqual({ label: "Ready", tone: "success" });
  });

  it("reports a catalog error", () => {
    expect(providerStatus({ ...base, catalog_status: "error" })).toEqual({
      label: "Error",
      tone: "danger",
    });
  });

  it("reports models not loaded", () => {
    expect(
      providerStatus({ ...base, catalog_status: "ready", model_count: 0 }),
    ).toEqual({ label: "Models not loaded", tone: "warning" });
  });

  it("reports ready", () => {
    expect(
      providerStatus({ ...base, catalog_status: "ready", model_count: 3 }),
    ).toEqual({ label: "Ready", tone: "success" });
  });
});

describe("isUsableConnection", () => {
  const base = aiSnapshot().connections.find((c) => c.source === "stored")!;

  it("is usable when enabled, persisted, has models and a key", () => {
    expect(isUsableConnection({ ...base, catalog_status: "ready" })).toBe(true);
  });

  it("is unusable without a persistent id", () => {
    expect(isUsableConnection({ ...base, persistent_id: null })).toBe(false);
  });

  it("is unusable without models", () => {
    expect(isUsableConnection({ ...base, model_count: 0 })).toBe(false);
  });

  it("does not require a key for ollama", () => {
    expect(
      isUsableConnection({
        ...base,
        provider: "ollama",
        has_key: false,
        model_count: 1,
      }),
    ).toBe(true);
  });
});

describe("splitConnections", () => {
  it("hides only the unkeyed, unpersisted, non-legacy environment connection", () => {
    const { hidden, shown } = splitConnections(aiSnapshot());
    expect(hidden.map((c) => c.id)).toEqual(["env:deepseek"]);
    expect(shown.map((c) => c.id).sort()).toEqual(
      [
        aiSnapshot().connections.find((c) => c.source === "stored")!.id,
        "env:gemini",
      ].sort(),
    );
  });
});

describe("reasoningPresets", () => {
  it("builds provider default, off, on and a deduplicated budget preset", () => {
    const budgetModel = catalog.models.find((m) => m.model_id === "budget")!;
    expect(reasoningPresets(budgetModel)).toEqual([
      { value: "provider_default", label: "Provider default" },
      { value: "disabled", label: "Off" },
      { value: "enabled", label: "On" },
      { value: "budget:100", label: "Thinking: 100 tokens" },
    ]);
  });

  it("lists one entry per reasoning level and skips budgets without a range", () => {
    const visionModel = catalog.models.find(
      (m) => m.model_id === "gemini-3.8-flash",
    )!;
    expect(reasoningPresets(visionModel)).toEqual([
      { value: "provider_default", label: "Provider default" },
      { value: "level:low", label: "Low" },
      { value: "level:high", label: "High" },
    ]);
  });
});

describe("reasoningLabel", () => {
  it("labels every mode", () => {
    expect(
      reasoningLabel({
        mode: "provider_default",
        level: null,
        budget_tokens: null,
      }),
    ).toBe("Provider default");
    expect(
      reasoningLabel({ mode: "disabled", level: null, budget_tokens: null }),
    ).toBe("Off");
    expect(
      reasoningLabel({ mode: "enabled", level: null, budget_tokens: null }),
    ).toBe("On");
    expect(
      reasoningLabel({ mode: "level", level: "high", budget_tokens: null }),
    ).toBe("High");
    expect(
      reasoningLabel({ mode: "budget", level: null, budget_tokens: 4096 }),
    ).toBe("Thinking: 4,096 tokens");
  });
});

describe("imageDetailLabel", () => {
  it("labels every known detail", () => {
    expect(imageDetailLabel("default")).toBe("Standard");
    expect(imageDetailLabel("high")).toBe("High");
    expect(imageDetailLabel("ultra_high")).toBe("Very high");
  });
});

describe("configSummary", () => {
  it("summarises a normal config", () => {
    const config: Config = {
      reasoning: { mode: "level", level: "high", budget_tokens: null },
      image_detail: "default",
      timeout_seconds: 8,
      max_output_tokens: 4096,
      max_input_tokens: 131072,
    };
    expect(configSummary(config)).toBe(
      "Reasoning: High · Image detail: Standard · Up to 8 s · 4,096 output tokens",
    );
  });

  it("summarises a legacy config", () => {
    expect(
      configSummary({
        kind: "legacy_snapshot",
        action_id: "shows.extract.vision",
        legacy_model: "gemini/old",
        legacy_options: {
          timeout_seconds: 90,
          max_tokens: 16000,
          image_detail: "default",
        },
      }),
    ).toBe("Kept from server settings");
  });
});

describe("reasonText", () => {
  const cases: [string, string][] = [
    ["AI_ACTION_NEEDS_IMAGE", "Needs a model that reads images"],
    ["AI_IMAGE_BOUND_UNKNOWN", "This model's image limits are unknown"],
    ["AI_CONTEXT_TOO_SMALL", "The model's context window is too small"],
    ["AI_MODEL_UNVALIDATED", "Its provider's models need a refresh"],
    ["AI_LEGACY_LIMITS_UNKNOWN", "Its model's limits are unknown"],
    ["AI_CREDENTIAL_REQUIRED", "No API key for its provider"],
    ["AI_PROVIDER_UNSUPPORTED", "Its provider is not supported"],
    ["AI_PROFILE_INCOMPATIBLE", "Not compatible with this model"],
    ["AI_ACTION_DISABLED", "Turned off"],
  ];

  it.each(cases)("maps %s", (code, expected) => {
    expect(reasonText(code)).toBe(expected);
  });

  it("falls back for unknown codes", () => {
    expect(reasonText("AI_SOMETHING_ELSE")).toBe("Not available");
    expect(reasonText(null)).toBe("Not available");
  });
});

describe("aiErrorText", () => {
  const cases: [string, string][] = [
    [
      "AI_CONFIGURATION_CONFLICT",
      "AI settings changed while you were editing. Review and try again.",
    ],
    [
      "AI_CONTEXT_STALE",
      "AI settings changed while you were editing. Review and try again.",
    ],
    [
      "AI_SETUP_BLOCKED",
      "Some features can't keep their current model. Choose another model or refresh the server provider's models.",
    ],
    ["AI_MODEL_INCOMPATIBLE", "This model can't run the selected features."],
    ["AI_CREDENTIAL_REQUIRED", "This connection needs an API key."],
    ["AI_CONNECTION_UNAVAILABLE", "This connection is turned off."],
    ["AI_MODEL_UNVALIDATED", "Refresh this connection's models first."],
    ["AI_PROFILE_INCOMPATIBLE", "This model doesn't support these options."],
    [
      "AI_CREDENTIAL_STORAGE",
      "Saving keys needs CRATE_CREDENTIAL_KEY on the server.",
    ],
    [
      "AI_ENVIRONMENT_READ_ONLY",
      "Keys from the server environment can't be changed here.",
    ],
  ];

  it.each(cases)("maps %s", (code, expected) => {
    expect(aiErrorText({ code })).toBe(expected);
  });

  it("falls back for errors without a known code, by duck typing only", () => {
    expect(aiErrorText(new Error("boom"))).toBe(
      "AI settings could not be saved. Reload and try again.",
    );
    expect(aiErrorText({ code: "AI_UNKNOWN_CODE" })).toBe(
      "AI settings could not be saved. Reload and try again.",
    );
    expect(aiErrorText(undefined)).toBe(
      "AI settings could not be saved. Reload and try again.",
    );
  });
});

describe("summaryModel", () => {
  it("prefers the default model", () => {
    expect(summaryModel(migratedSnapshot())).toBe("gemini-3.8-flash");
  });

  it("falls back to the most frequent model among enabled bindings", () => {
    const base = migratedSnapshot();
    const [posterProfile] = base.profiles;
    if (!posterProfile) throw new Error("expected a fixture profile");
    const otherConfig = posterProfile.versions[0]?.config;
    if (!otherConfig) throw new Error("expected a fixture profile version");
    const snapshot: Snapshot = {
      ...base,
      default_model: null,
      profiles: [
        ...base.profiles,
        {
          id: "other-profile",
          label: "Other",
          current_version: 1,
          created_at: posterProfile.created_at,
          versions: [
            {
              profile_id: "other-profile",
              version: 1,
              connection_id: STUDIO_ID,
              model_id: "alt-model",
              config: otherConfig,
              fingerprint: "b".repeat(64),
              created_at: posterProfile.created_at,
            },
          ],
        },
      ],
      bindings: [
        {
          action_id: "shows.extract.vision",
          profile_id: PROFILE_ID,
          profile_version: 1,
          revision: 1,
          enabled: true,
        },
        {
          action_id: "genres.eq.propose",
          profile_id: PROFILE_ID,
          profile_version: 1,
          revision: 1,
          enabled: true,
        },
        {
          action_id: "music_paths.refine",
          profile_id: "other-profile",
          profile_version: 1,
          revision: 1,
          enabled: true,
        },
      ],
    };
    expect(summaryModel(snapshot)).toBe("gemini-3.8-flash");
  });

  it("falls back to the legacy model when nothing is bound", () => {
    expect(summaryModel(aiSnapshot())).toBe("gemini-3.8-flash");
  });

  it("falls back to 'No model' when nothing is known", () => {
    const snapshot = aiSnapshot();
    snapshot.legacy_actions = [];
    expect(summaryModel(snapshot)).toBe("No model");
  });
});

describe("activeFeatureCount", () => {
  it("counts enabled bindings when migrated", () => {
    expect(activeFeatureCount(migratedSnapshot())).toBe(3);
  });

  it("counts supported legacy actions when not migrated", () => {
    expect(activeFeatureCount(aiSnapshot())).toBe(4);
  });
});

describe("featureModelView", () => {
  it("shows server settings before setup", () => {
    expect(featureModelView(aiSnapshot(), "shows.extract.vision")).toEqual({
      label: "Server settings",
      tone: "neutral",
      model: "gemini-3.8-flash",
    });
  });

  it("shows not set when no binding exists", () => {
    expect(featureModelView(migratedSnapshot(), "unknown.action")).toEqual({
      label: "Not set",
      tone: "warning",
      model: null,
    });
  });

  it("shows the default status", () => {
    expect(
      featureModelView(migratedSnapshot(), "shows.extract.vision"),
    ).toEqual({ label: "Default", tone: "info", model: "gemini-3.8-flash" });
  });

  it("shows the incompatible status as the current model", () => {
    expect(featureModelView(migratedSnapshot(), "shows.extract.text")).toEqual({
      label: "Current model",
      tone: "neutral",
      model: "gemini-3.8-flash",
    });
  });

  it("shows the override status", () => {
    expect(featureModelView(migratedSnapshot(), "genres.eq.propose")).toEqual({
      label: "Override",
      tone: "neutral",
      model: "gemini-3.8-flash",
    });
  });
});

describe("usageToday", () => {
  it("sums calls, tokens and failed over today's rows only", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    expect(usageToday(usageFixture(now), now)).toEqual({
      calls: 4,
      tokens: 1200,
      failed: 1,
    });
  });
});

describe("dailyTokenBudget", () => {
  it("sums daily_tokens over distinct connections of enabled bindings", () => {
    expect(dailyTokenBudget(migratedSnapshot())).toBe(1000000);
  });

  it("is null before migration", () => {
    expect(dailyTokenBudget(aiSnapshot())).toBeNull();
  });
});

describe("dailyUsageSeries", () => {
  it("returns 30 zero-filled days ending today", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const series = dailyUsageSeries(usageFixture(now), 30, now);
    expect(series).toHaveLength(30);
    const lastDay = series[series.length - 1];
    expect(lastDay?.day).toBe("2026-10-20");
    expect(lastDay).toEqual({
      day: "2026-10-20",
      Completed: 3,
      Failed: 1,
      tokens: 1200,
    });
    expect(series[0]).toEqual({
      day: "2026-09-21",
      Completed: 0,
      Failed: 0,
      tokens: 0,
    });
  });
});

describe("invocationStatusView", () => {
  it("views every status", () => {
    expect(invocationStatusView("succeeded")).toEqual({
      label: "Succeeded",
      tone: "success",
    });
    expect(invocationStatusView("failed")).toEqual({
      label: "Failed",
      tone: "danger",
    });
    expect(invocationStatusView("timeout")).toEqual({
      label: "Timed out",
      tone: "danger",
    });
    expect(invocationStatusView("reserved")).toEqual({
      label: "Running",
      tone: "info",
    });
    expect(invocationStatusView("cancelled")).toEqual({
      label: "Cancelled",
      tone: "neutral",
    });
  });
});

describe("formatTokens", () => {
  it("reports unknown when both sides are null", () => {
    expect(formatTokens({ input_tokens: null, output_tokens: null })).toBe(
      "Unknown",
    );
  });

  it("formats both sides", () => {
    expect(formatTokens({ input_tokens: 53, output_tokens: 5 })).toBe(
      "53 in · 5 out",
    );
  });

  it("shows a question mark for a missing side", () => {
    expect(formatTokens({ input_tokens: null, output_tokens: 5 })).toBe(
      "? in · 5 out",
    );
    expect(formatTokens({ input_tokens: 53, output_tokens: null })).toBe(
      "53 in · ? out",
    );
  });
});

describe("formatDuration", () => {
  it("formats milliseconds, seconds and minutes", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(3523)).toBe("3.5 s");
    expect(formatDuration(77100)).toBe("1 min 17 s");
  });
});

describe("formatCount", () => {
  it("formats with thousands separators", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("outcomeGroups", () => {
  it("groups outcomes into uses, kept and blocked", () => {
    const outcomes: AssignmentOutcome[] = [
      { action_id: "a", outcome: "applied", reason: null, adjustments: [] },
      { action_id: "b", outcome: "unchanged", reason: null, adjustments: [] },
      {
        action_id: "c",
        outcome: "kept_legacy",
        reason: null,
        adjustments: [],
      },
      {
        action_id: "d",
        outcome: "kept_current",
        reason: null,
        adjustments: [],
      },
      {
        action_id: "e",
        outcome: "blocked",
        reason: "AI_ACTION_DISABLED",
        adjustments: [],
      },
    ];
    expect(outcomeGroups(outcomes)).toEqual({ uses: 2, kept: 2, blocked: 1 });
  });
});
