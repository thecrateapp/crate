import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { migratedSnapshot, STUDIO_ID, catalog } from "./test-fixtures";
import { PROVIDER_DEFAULT_REASONING } from "@/lib/ai-models";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));

import { ModelPicker } from "./ModelPicker";

const STUDIO_CHOICE = {
  connectionId: STUDIO_ID,
  modelId: "gemini-3.8-flash",
  reasoning: PROVIDER_DEFAULT_REASONING,
};

beforeEach(() => {
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url?.endsWith("/models") ? catalog : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
});

describe("ModelPicker", () => {
  it("reports the catalog entry of a preselected model", async () => {
    const onModelResolved = vi.fn();
    renderWithAdminProviders(
      <ModelPicker
        snapshot={migratedSnapshot()}
        value={STUDIO_CHOICE}
        onChange={vi.fn()}
        onModelResolved={onModelResolved}
      />,
    );

    await waitFor(() =>
      expect(onModelResolved).toHaveBeenLastCalledWith(catalog.models[0]),
    );
  });

  it("explains a catalog that could not be loaded", () => {
    useApiMock.mockImplementation(() => ({
      data: null,
      loading: false,
      error: '{"detail":"Internal Server Error"}',
      refetch: vi.fn(),
    }));
    const onModelResolved = vi.fn();
    renderWithAdminProviders(
      <ModelPicker
        snapshot={migratedSnapshot()}
        value={STUDIO_CHOICE}
        onChange={vi.fn()}
        onModelResolved={onModelResolved}
      />,
    );

    expect(
      screen.getByText("Couldn't load this connection's models."),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain("Internal Server Error");
    expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
    expect(onModelResolved).not.toHaveBeenCalled();
  });
});
