import { render, screen, waitFor } from "@testing-library/react";
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
  issueCount: 1,
  errorCount: 1,
  warningCount: 0,
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
  ],
};

describe("I18nReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.mockImplementation((url: string, method = "GET") => {
      if (url === "/api/admin/i18n/listen/requests") {
        return Promise.resolve({ requests: [request] });
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
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });
  });

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
    ).toHaveTextContent("1 draft");
    expect(
      screen.getByRole("article", { name: "es locale health" }),
    ).toHaveTextContent("1 request");
    expect(
      screen.getByRole("article", { name: "fr locale health" }),
    ).toHaveTextContent("1 published");
    expect(
      screen.getByRole("article", { name: "de locale health" }),
    ).toHaveTextContent("No bundle yet");
  });

  it("reviews and publishes a Listen translation bundle", async () => {
    const user = userEvent.setup();

    render(<I18nReview />);

    await user.click(await screen.findByRole("tab", { name: "Bundles" }));
    expect(
      await screen.findByRole("button", { name: /Review es/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2 strings").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Review es/i }));

    expect(await screen.findByText("player.play")).toBeInTheDocument();
    expect(screen.getByText("Reproducir")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Quality issues" }),
    ).toBeInTheDocument();
    expect(screen.getByText("settings.profile.bio")).toBeInTheDocument();
    expect(screen.getByText("Translation value is empty.")).toBeInTheDocument();

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
});
