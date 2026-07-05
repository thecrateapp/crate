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

const bundleDetail = {
  ...bundleSummary,
  messages: {
    "player.play": "Reproducir",
    "nav.collection": "Coleccion",
  },
};

describe("I18nReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.mockImplementation((url: string, method = "GET") => {
      if (url === "/api/admin/i18n/listen/requests") {
        return Promise.resolve({ requests: [request] });
      }
      if (url === "/api/admin/i18n/listen/bundles?status=needs_review") {
        return Promise.resolve({ bundles: [bundleSummary] });
      }
      if (url === "/api/admin/i18n/listen/bundles/bundle-es") {
        return Promise.resolve(bundleDetail);
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

  it("reviews and publishes a Listen translation bundle", async () => {
    const user = userEvent.setup();

    render(<I18nReview />);

    expect(
      await screen.findByRole("heading", { name: "Listen translation review" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("es")).toBeInTheDocument();
    expect(screen.getByText("2 strings")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Review es/i }));

    expect(await screen.findByText("player.play")).toBeInTheDocument();
    expect(screen.getByText("Reproducir")).toBeInTheDocument();

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
