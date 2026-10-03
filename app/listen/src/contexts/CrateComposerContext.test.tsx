import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/lib/api", () => ({ api }));
vi.mock("sonner", () => ({ toast }));

import {
  CrateComposerProvider,
  openCrateComposerForAlbum,
  useCrateComposer,
} from "@/contexts/CrateComposerContext";
import { I18nProvider } from "@/i18n";

function Harness() {
  const { openCreateCrate } = useCrateComposer();
  return (
    <button
      type="button"
      onClick={() =>
        openCreateCrate({
          album: {
            globalAlbumUid: "album-1",
            name: "Blending",
            artistName: "High Vis",
          },
        })
      }
    >
      Open crate composer
    </button>
  );
}

describe("CrateComposerProvider", () => {
  beforeEach(() => {
    navigate.mockReset();
    api.mockReset();
    toast.error.mockReset();
    toast.success.mockReset();
    api.mockImplementation(async (url: string) =>
      url === "/api/crates" ? { id: "crate-1" } : undefined,
    );
  });

  it("does not open the composer without a global album UID", () => {
    const openCreateCrate = vi.fn();

    expect(
      openCrateComposerForAlbum(
        { openCreateCrate },
        { globalAlbumUid: undefined, name: "Blending", artistName: "High Vis" },
      ),
    ).toBe(false);
    expect(openCreateCrate).not.toHaveBeenCalled();
  });

  it("opens the composer with the normalized album payload", () => {
    const openCreateCrate = vi.fn();

    expect(
      openCrateComposerForAlbum(
        { openCreateCrate },
        { globalAlbumUid: "album-1", name: "Blending", artistName: "High Vis" },
      ),
    ).toBe(true);
    expect(openCreateCrate).toHaveBeenCalledWith({
      album: {
        globalAlbumUid: "album-1",
        name: "Blending",
        artistName: "High Vis",
      },
    });
  });

  it("creates a Crate and carries the source album into it", async () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="es">
          <CrateComposerProvider>
            <Harness />
          </CrateComposerProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open crate composer" }),
    );
    expect(screen.getByTestId("crate-form")).toBeInTheDocument();
    expect(screen.getByText("Blending · High Vis")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Best of 2026" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Reproducción en bucle" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Crear Crate" }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(1, "/api/crates", "POST", {
        name: "Best of 2026",
        description: "",
        visibility: "private",
        is_collaborative: false,
        is_ordered: false,
        sort_direction: "asc",
        loop_enabled: true,
      });
      expect(api).toHaveBeenNthCalledWith(
        2,
        "/api/crates/crate-1/albums",
        "POST",
        { global_album_uid: "album-1" },
      );
      expect(navigate).toHaveBeenCalledWith("/crate/crate-1");
    });
  });

  it("keeps the created Crate when adding the source album fails", async () => {
    api.mockImplementation(async (url: string) => {
      if (url === "/api/crates") return { id: "crate-1" };
      throw new Error("album association failed");
    });

    render(
      <MemoryRouter>
        <I18nProvider initialLocale="es">
          <CrateComposerProvider>
            <Harness />
          </CrateComposerProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open crate composer" }),
    );
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Best of 2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear Crate" }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/crate/crate-1");
      expect(toast.success).toHaveBeenCalledWith("Crate creado");
      expect(toast.error).toHaveBeenCalledWith(
        "No se pudo añadir el álbum a Crate",
      );
    });
    expect(api).toHaveBeenCalledTimes(2);
  });
});
