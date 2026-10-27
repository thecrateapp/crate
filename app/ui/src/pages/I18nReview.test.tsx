import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { toast } from "sonner";
import { I18nReview } from "./I18nReview";

const mockApi = vi.mocked(api);
const mockToast = vi.mocked(toast);

const request = {
  id: "request-es",
  app: "listen",
  locale: "es",
  sourceVersion: "sha256:test",
  client: "web",
  reason: "unsupported-locale",
  status: "needs_review",
  taskId: "task-es",
  createdAt: "2026-07-05T10:00:00+00:00",
  updatedAt: "2026-07-05T10:05:00+00:00",
};

const bundleSummary = {
  id: "bundle-es",
  app: "listen",
  locale: "es",
  sourceLocale: "en",
  sourceVersion: "sha256:test",
  bundleVersion: "2026.07.05.1",
  status: "needs_review",
  messageCount: 2,
  createdAt: "2026-07-05T10:06:00+00:00",
  publishedAt: null,
};

const publishedBundleSummary = {
  id: "bundle-fr",
  app: "listen",
  locale: "fr",
  sourceLocale: "en",
  sourceVersion: "sha256:test",
  bundleVersion: "2026.07.05.2",
  status: "published",
  messageCount: 2,
  createdAt: "2026-07-05T10:06:00+00:00",
  publishedAt: "2026-07-05T10:20:00+00:00",
};

const bundleDetail = {
  ...bundleSummary,
  messages: {
    "player.play": "Reproducir",
    "nav.collection": "Coleccion",
  },
};

const qualityReport = {
  schema: "crate.listen.i18n.quality.v1",
  sourceVersion: "sha256:test",
  generatedAt: "2026-07-05T10:08:00+00:00",
  locales: ["es"],
  issueCount: 2,
  errorCount: 1,
  warningCount: 1,
  issues: [
    {
      severity: "error",
      code: "empty_value",
      locale: "es",
      key: "settings.profile.bio",
      message: "Translation value is empty.",
      source: null,
      value: "",
      file: null,
    },
    {
      severity: "warning",
      code: "stale_translation",
      locale: "es",
      key: "nav.collection",
      message: "Translation needs review.",
      source: null,
      value: "Coleccion",
      file: null,
    },
  ],
};

const exportedBundle = {
  schema: "crate.i18n.bundle.export.v1",
  locale: "es",
  sourceVersion: "sha256:test",
  bundleVersion: "2026.07.05.1",
  messages: {
    "player.play": "Dale",
    "nav.collection": "Coleccion",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("fetch disabled in tests"))),
  );
  mockApi.mockImplementation((url: string, method = "GET") => {
    if (url === "/api/admin/i18n/listen/requests") {
      return Promise.resolve({ aiConfigured: true, requests: [request] });
    }
    if (url === "/api/admin/i18n/listen/bundles") {
      return Promise.resolve({
        bundles: [bundleSummary, publishedBundleSummary],
      });
    }
    if (url === "/api/admin/i18n/listen/bundles/bundle-es") {
      return Promise.resolve(bundleDetail);
    }
    if (
      url ===
      "/api/admin/i18n/listen/quality?locale=es&source_version=sha256%3Atest"
    ) {
      return Promise.resolve(qualityReport);
    }
    if (
      url === "/api/admin/i18n/listen/bundles/bundle-es/publish" &&
      method === "POST"
    ) {
      return Promise.resolve({
        ...bundleDetail,
        status: "published",
        publishedAt: "2026-07-05T10:10:00+00:00",
      });
    }
    if (
      url === "/api/admin/i18n/listen/bundles/bundle-es/reject" &&
      method === "POST"
    ) {
      return Promise.resolve({ ...bundleDetail, status: "rejected" });
    }
    if (
      url === "/api/admin/i18n/listen/bundles/bundle-es/messages/player.play" &&
      method === "PATCH"
    ) {
      return Promise.resolve({
        ...bundleDetail,
        messages: {
          ...bundleDetail.messages,
          "player.play": "Dale",
        },
      });
    }
    if (url === "/api/admin/i18n/listen/bundles/bundle-es/export") {
      return Promise.resolve(exportedBundle);
    }
    if (
      url === "/api/admin/i18n/listen/locales/es/draft-missing" &&
      method === "POST"
    ) {
      return Promise.resolve({
        requestId: "request-es",
        status: "drafting_ai",
      });
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
});

describe("I18nReview", () => {
  it("renders the Listen translation manager overview", async () => {
    render(<I18nReview />);

    expect(
      await screen.findByRole("heading", { name: "Listen Translations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Bundles" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Editor" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Import / Export" }),
    ).toBeInTheDocument();

    expect(
      await screen.findByRole("heading", { name: "Locale health" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "es locale health" }),
    ).toHaveAccessibleName("es locale health");
    expect(
      within(
        screen.getByRole("article", { name: "es locale health" }),
      ).getByRole("group", { name: "1 draft" }),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("article", { name: "es locale health" }),
      ).getByRole("group", { name: "1 request" }),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("article", { name: "fr locale health" }),
      ).getByRole("group", { name: "1 published bundle" }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", { name: "de locale health" }),
    ).toHaveTextContent("No bundle yet");
  });

  it("uses the shared locale filter and filters bundles without native selects", async () => {
    const user = userEvent.setup();
    const { container } = render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    expect(container.querySelectorAll("select")).toHaveLength(0);

    const localeFilter = screen.getByRole("combobox", { name: "Locale" });
    await user.click(localeFilter);
    await user.click(await screen.findByRole("option", { name: "fr" }));

    expect(
      screen.queryByRole("button", { name: "Review es" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review fr" }),
    ).toBeInTheDocument();
  });

  it.each([0, 1, 2])(
    "shows the published bundle count for %i bundles",
    async (count) => {
      const original = mockApi.getMockImplementation()!;
      mockApi.mockImplementation((url, ...args) =>
        url === "/api/admin/i18n/listen/bundles"
          ? Promise.resolve({
              bundles: Array.from({ length: count }, (_, index) => ({
                ...publishedBundleSummary,
                id: `published-${index}`,
              })),
            })
          : original(url, ...args),
      );
      render(<I18nReview />);
      const health = await screen.findByRole("article", {
        name: "fr locale health",
      });
      expect(
        within(health).getByRole("group", {
          name: `${count} published bundle${count === 1 ? "" : "s"}`,
        }),
      ).toBeVisible();
    },
  );

  it("queues an AI draft for missing or stale locale keys", async () => {
    const user = userEvent.setup();

    render(<I18nReview />);

    await user.click(
      await screen.findByRole("button", {
        name: "Draft missing/stale with AI for es",
      }),
    );

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/i18n/listen/locales/es/draft-missing",
        "POST",
        { sourceVersion: "sha256:test" },
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "AI translation draft queued",
    );
  });

  it("reviews and publishes a Listen translation bundle", async () => {
    const user = userEvent.setup();

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    expect(
      await screen.findByRole("button", { name: /Review es/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2 strings").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByText("Needs review")
        .some((node) =>
          node
            .closest('[data-slot="info-badge"]')
            ?.className.includes("text-state-warning-text"),
        ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /Review es/i }));

    expect(await screen.findByText("player.play")).toBeInTheDocument();
    expect(screen.getByText("Reproducir")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Quality issues" }),
    ).toBeInTheDocument();
    expect(screen.getByText("settings.profile.bio")).toBeInTheDocument();
    expect(screen.getByText("Translation value is empty.")).toBeInTheDocument();
    for (const [code, severity, tone] of [
      ["empty_value", "error", "error"],
      ["stale_translation", "warning", "warn"],
    ] as const) {
      const issue = screen.getByText(code).parentElement!;
      expect(
        within(issue).getByText(severity).closest('[data-slot="severity"]'),
      ).toHaveAttribute("data-tone", tone);
    }

    await user.click(screen.getByRole("button", { name: "Publish bundle" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/i18n/listen/bundles/bundle-es/publish",
        "POST",
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Translation bundle published",
    );
  });

  it("rejects a selected Listen translation bundle", async () => {
    const user = userEvent.setup();

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    await user.click(await screen.findByRole("button", { name: /Review es/i }));
    await screen.findByText("player.play");

    await user.click(screen.getByRole("button", { name: "Reject bundle" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/i18n/listen/bundles/bundle-es/reject",
        "POST",
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Translation bundle rejected",
    );
  });

  it("edits a bundle row and exports JSON", async () => {
    const user = userEvent.setup();

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    await user.click(await screen.findByRole("button", { name: /Review es/i }));

    const playTranslation = await screen.findByLabelText(
      "Translation for player.play",
    );
    await user.clear(playTranslation);
    await user.type(playTranslation, "Dale");
    await user.click(screen.getByRole("button", { name: "Save player.play" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/i18n/listen/bundles/bundle-es/messages/player.play",
        "PATCH",
        { value: "Dale" },
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith("Translation key saved");

    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/i18n/listen/bundles/bundle-es/export",
      );
    });
    expect(
      screen.getByText(/crate\.i18n\.bundle\.export\.v1/),
    ).toBeInTheDocument();
    expect(screen.getByText(/"player.play": "Dale"/)).toBeInTheDocument();
  });

  it("saves a bundle row to workspace JSON when Listen dev catalogs are available", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:5174/__crate_i18n/catalogs") {
        return Promise.resolve(
          new Response(JSON.stringify({ locales: ["es"] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (
        url === "http://127.0.0.1:5174/__crate_i18n/catalogs/es" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ reviewed: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    await user.click(await screen.findByRole("button", { name: /Review es/i }));

    const playTranslation = await screen.findByLabelText(
      "Translation for player.play",
    );
    await user.clear(playTranslation);
    await user.type(playTranslation, "Dale");
    await user.click(
      await screen.findByRole("button", {
        name: "Save player.play to workspace JSON",
      }),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:5174/__crate_i18n/catalogs/es",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const patchCall = fetchSpy.mock.calls.find(
      ([url, init]) =>
        String(url) === "http://127.0.0.1:5174/__crate_i18n/catalogs/es" &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      key: "player.play",
      value: "Dale",
      markReviewed: true,
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Translation key saved to workspace JSON",
    );
  });

  it("hides workspace JSON actions when Listen dev catalogs are unavailable", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() =>
      Promise.reject(new Error("Listen dev server unavailable")),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    await user.click(await screen.findByRole("button", { name: /Review es/i }));
    await screen.findByLabelText("Translation for player.play");

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:5174/__crate_i18n/catalogs",
        expect.objectContaining({ method: "GET" }),
      );
    });
    expect(
      screen.queryByRole("button", {
        name: "Save player.play to workspace JSON",
      }),
    ).not.toBeInTheDocument();
  });

  it("does not probe workspace JSON actions outside dev mode", async () => {
    vi.stubEnv("DEV", false);
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ locales: ["es"] }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    await user.click(await screen.findByRole("button", { name: /Review es/i }));
    await screen.findByLabelText("Translation for player.play");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", {
        name: "Save player.play to workspace JSON",
      }),
    ).not.toBeInTheDocument();
  });
});

it("keeps manual review available when AI draft action is unavailable", async () => {
  mockApi.mockResolvedValue({ requests: [], bundles: [], locales: [] });
  render(<I18nReview />);
  expect(
    screen.getByText(/AI drafts unavailable · manual review ready/),
  ).toBeVisible();
});

function pendingResponse<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does not expose actions for the previous bundle while the next one is pending", async () => {
  const user = userEvent.setup();
  const pending = pendingResponse<typeof bundleDetail>();
  const second = { ...bundleSummary, id: "bundle-fr", locale: "fr" };
  const implementation = mockApi.getMockImplementation()!;
  mockApi.mockImplementation((url, method, body, options) => {
    if (url === "/api/admin/i18n/listen/bundles")
      return Promise.resolve({ bundles: [bundleSummary, second] });
    if (url === "/api/admin/i18n/listen/bundles/bundle-fr")
      return pending.promise;
    if (url === "/api/admin/i18n/listen/bundles/bundle-fr/publish")
      return Promise.resolve({
        ...second,
        messages: { greeting: "Bonjour" },
        status: "published",
      });
    if (url.startsWith("/api/admin/i18n/listen/quality?locale=fr"))
      return Promise.resolve(qualityReport);
    return implementation(url, method, body, options);
  });
  render(<I18nReview />);
  await user.click(await screen.findByRole("tab", { name: "Bundles" }));
  await user.click(await screen.findByRole("button", { name: "Review es" }));
  await screen.findByDisplayValue("Reproducir");
  await user.click(screen.getByRole("tab", { name: "Bundles" }));
  await user.click(screen.getByRole("button", { name: "Review fr" }));
  expect(
    screen.getByRole("status", { name: "Loading translations" }),
  ).toBeVisible();
  for (const name of ["Publish bundle", "Reject bundle", "Export JSON"]) {
    const button = screen.queryByRole("button", { name });
    if (button) expect(button).toBeDisabled();
  }
  await act(async () => {
    pending.resolve({
      ...second,
      messages: { "player.play": "Bonjour", "nav.collection": "Bibliothèque" },
    });
    await pending.promise;
  });
  expect(await screen.findByDisplayValue("Bonjour")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Publish bundle" }));
  expect(mockApi).toHaveBeenCalledWith(
    "/api/admin/i18n/listen/bundles/bundle-fr/publish",
    "POST",
  );
});

it("preserves other dirty translations and edits typed while a key is saving", async () => {
  const user = userEvent.setup();
  const pending = pendingResponse<typeof bundleDetail>();
  const implementation = mockApi.getMockImplementation()!;
  mockApi.mockImplementation((url, method, body, options) => {
    if (method === "PATCH") return pending.promise;
    return implementation(url, method, body, options);
  });
  render(<I18nReview />);
  await user.click(await screen.findByRole("tab", { name: "Bundles" }));
  await user.click(await screen.findByRole("button", { name: "Review es" }));
  const play = await screen.findByLabelText("Translation for player.play");
  const collection = screen.getByLabelText("Translation for nav.collection");
  expect(
    screen.getByRole("textbox", { name: "Translation for player.play" }),
  ).toBe(play);
  expect(
    screen.getByRole("textbox", { name: "Translation for nav.collection" }),
  ).toBe(collection);
  await user.clear(collection);
  await user.type(collection, "Mi biblioteca");
  await user.clear(play);
  await user.type(play, "Dale");
  await user.click(screen.getByRole("button", { name: "Save player.play" }));
  await user.type(play, " ahora");
  await act(async () => {
    pending.resolve({
      ...bundleDetail,
      messages: { ...bundleDetail.messages, "player.play": "Dale" },
    });
    await pending.promise;
  });
  expect(collection).toHaveValue("Mi biblioteca");
  expect(play).toHaveValue("Dale ahora");
});

it("offers retry for the requested bundle after a failed detail read", async () => {
  const user = userEvent.setup();
  let reads = 0;
  const implementation = mockApi.getMockImplementation()!;
  mockApi.mockImplementation((url, method, body, options) => {
    if (url === "/api/admin/i18n/listen/bundles/bundle-es") {
      reads += 1;
      if (reads === 1) return Promise.reject(new Error("temporary"));
    }
    return implementation(url, method, body, options);
  });
  render(<I18nReview />);
  await user.click(await screen.findByRole("tab", { name: "Bundles" }));
  await user.click(await screen.findByRole("button", { name: "Review es" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/bundle/i);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByDisplayValue("Reproducir")).toBeVisible();
});

it("ignores a previous bundle read that finishes after the newly selected bundle", async () => {
  const user = userEvent.setup();
  const pending = pendingResponse<typeof bundleDetail>();
  const second = {
    ...bundleSummary,
    id: "bundle-fr",
    locale: "fr",
    messages: { greeting: "Bonjour" },
  };
  const implementation = mockApi.getMockImplementation()!;
  mockApi.mockImplementation((url, method, body, options) => {
    if (url === "/api/admin/i18n/listen/bundles")
      return Promise.resolve({ bundles: [bundleSummary, second] });
    if (url === "/api/admin/i18n/listen/bundles/bundle-es")
      return pending.promise;
    if (url === "/api/admin/i18n/listen/bundles/bundle-fr")
      return Promise.resolve(second);
    if (url.startsWith("/api/admin/i18n/listen/quality?locale=fr"))
      return Promise.resolve(qualityReport);
    return implementation(url, method, body, options);
  });
  render(<I18nReview />);
  await user.click(await screen.findByRole("tab", { name: "Bundles" }));
  await user.click(await screen.findByRole("button", { name: "Review es" }));
  await user.click(screen.getByRole("tab", { name: "Bundles" }));
  await user.click(screen.getByRole("button", { name: "Review fr" }));
  await screen.findByDisplayValue("Bonjour");
  await act(async () => {
    pending.resolve(bundleDetail);
    await pending.promise;
  });
  expect(screen.getByDisplayValue("Bonjour")).toBeVisible();
  expect(screen.queryByDisplayValue("Reproducir")).not.toBeInTheDocument();
});

it.each(["key", "publish"])(
  "serializes key saves and review actions while %s is pending",
  async (operation) => {
    const user = userEvent.setup();
    const pending = pendingResponse<typeof bundleDetail>();
    const implementation = mockApi.getMockImplementation()!;
    mockApi.mockImplementation((url, method, body, options) => {
      if (
        (operation === "key" && method === "PATCH") ||
        (operation === "publish" && url.endsWith("/publish"))
      )
        return pending.promise;
      return implementation(url, method, body, options);
    });
    render(<I18nReview />);
    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    await user.click(await screen.findByRole("button", { name: "Review es" }));
    await screen.findByDisplayValue("Reproducir");
    if (operation === "key") {
      await user.click(
        screen.getByRole("button", { name: "Save player.play" }),
      );
      expect(
        screen.getByRole("button", { name: "Publish bundle" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Reject bundle" }),
      ).toBeDisabled();
    } else {
      await user.click(screen.getByRole("button", { name: "Publish bundle" }));
      expect(
        screen.getByRole("button", { name: "Save player.play" }),
      ).toBeDisabled();
    }
    await act(async () => {
      pending.resolve(bundleDetail);
      await pending.promise;
    });
  },
);
