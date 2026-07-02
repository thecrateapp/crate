import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Stats } from "./Stats";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

const mockUseApi = vi.mocked(useApi);

describe("Stats page", () => {
  beforeEach(() => {
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("localizes the main stats chrome", () => {
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(screen.getByText("ADN de escucha")).toBeInTheDocument();
    expect(screen.getByText("Tu sonido")).toBeInTheDocument();
    expect(screen.getByText("descifrado")).toBeInTheDocument();
    expect(screen.getByText("Tu ADN")).toBeInTheDocument();
    expect(screen.getByText("Pulso Crate")).toBeInTheDocument();
    expect(
      screen.getByText("Tus estadísticas esperan una señal"),
    ).toBeInTheDocument();
  });
});
