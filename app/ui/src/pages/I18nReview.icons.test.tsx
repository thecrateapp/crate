import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../tests/admin-e2e/fixtures/translations-1an.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { api } from "@/lib/api";
import { I18nReview } from "./I18nReview";
const mockedApi = vi.mocked(api);
const responses = fixture as Record<string, unknown>;
describe("Translations reviewed visual contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("No live catalogs"))),
    );
    mockedApi.mockImplementation(async (path) => {
      if (!(path in responses)) throw new Error(`Unexpected ${path}`);
      return structuredClone(responses[path]);
    });
  });
  it("uses display headings and textual ready/empty states without decorative glyphs", async () => {
    const user = userEvent.setup();
    const { container } = render(<I18nReview />);
    await screen.findByRole("article", { name: "es locale health" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "font-display",
    );
    expect(
      container.querySelectorAll('svg[data-admin-ux="header-refresh"]'),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Editor" }));
    expect(screen.getByText("Select a bundle to review")).toBeVisible();
    expect(
      container.querySelectorAll('svg[data-admin-ux="header-refresh"]'),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Bundles" }));
    await user.click(screen.getByRole("radio", { name: "Rejected" }));
    expect(screen.getByText("No bundles match the filters")).toBeVisible();
    expect(
      container.querySelectorAll('svg[data-admin-ux="header-refresh"]'),
    ).toHaveLength(1);
  });
  it("keeps refresh and loading glyphs with accessible loading status", async () => {
    let resolve!: (value: unknown) => void;
    mockedApi.mockImplementation((path) =>
      path.endsWith("/requests")
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(responses[path]),
    );
    const { container } = render(<I18nReview />);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(
      screen.getByRole("status", { name: "Loading translations" }),
    ).toBeVisible();
    expect(
      container.querySelector('[data-admin-ux="translations-refresh"]'),
    ).toBeInTheDocument();
    await act(async () =>
      resolve(responses["/api/admin/i18n/listen/requests"]),
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(
      container.querySelectorAll('svg[data-admin-ux="header-refresh"]'),
    ).toHaveLength(1);
  });
  it("keeps real editor metadata, labelled translation fields and named pending publish", async () => {
    const user = userEvent.setup();
    const { container } = render(<I18nReview />);
    await screen.findByRole("article", { name: "es locale health" });
    await user.click(screen.getByRole("tab", { name: "Bundles" }));
    await user.click(screen.getByRole("button", { name: "Review es" }));
    await screen.findByLabelText("Translation for player.play");
    expect(
      screen.getByText("Version", { exact: true }).parentElement,
    ).toHaveClass("crate-form-field");
    expect(
      screen.getByLabelText("Translation for player.play").parentElement,
    ).toHaveClass("crate-form-field");
    expect(
      container.querySelectorAll('svg[data-admin-ux="header-refresh"]'),
    ).toHaveLength(1);
    let finish!: (value: unknown) => void;
    mockedApi.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Publish bundle" }));
    const button = screen.getByRole("button", { name: "Publish bundle" });
    expect(button).toBeDisabled();
    expect(
      within(button).getByTestId("translations-publish-progress"),
    ).toHaveAttribute("data-admin-ux", "translations-publish");
    expect(mockedApi).toHaveBeenLastCalledWith(
      "/api/admin/i18n/listen/bundles/bundle-es/publish",
      "POST",
    );
    await act(async () =>
      finish({
        ...fixture["/api/admin/i18n/listen/bundles/bundle-es"],
        status: "published",
      }),
    );
    expect(button).toBeDisabled();
    expect(
      container.querySelectorAll('svg[data-admin-ux="header-refresh"]'),
    ).toHaveLength(1);
  });
});
