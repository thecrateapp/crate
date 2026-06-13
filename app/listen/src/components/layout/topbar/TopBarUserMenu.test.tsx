import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

let isDesktop = true;
let canHover = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

vi.mock("@/lib/input-capabilities", () => ({
  isTouchDominantPointer: () => false,
}));

vi.mock("@/lib/platform", () => ({
  capacitorPlatform: "web",
  getListenAppId: () => "listen-web",
  getListenRuntime: () => "web",
  isCapacitorRuntime: false,
  isTauriRuntime: false,
  isWebRuntime: true,
  listenRuntime: "web",
  shouldRegisterServiceWorker: true,
  supportsHaptics: false,
  usesConfigurableServer: false,
  usesMobileShell: false,
  usesNativeFilesystem: false,
}));

const navigateMock = vi.fn();
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const user = createMockAuthUser({
  email: "diego@example.test",
  name: "Diego",
  username: "diego",
});

function renderMenu() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 16,
    left: 320,
    right: 368,
    bottom: 64,
    width: 48,
    height: 48,
    toJSON: () => ({}),
  });

  return renderWithListenProviders(<TopBarUserMenu />, {
    auth: { user },
  });
}

describe("TopBarUserMenu", () => {
  beforeEach(() => {
    isDesktop = true;
    canHover = true;
    navigateMock.mockClear();
    vi.restoreAllMocks();
  });

  it("uses the canonical glass context menu on desktop", async () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "User menu" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "rounded-2xl",
      "z-app-context-menu",
    );
    expect(screen.getByText("Diego")).toBeInTheDocument();
    expect(screen.getByText("diego@example.test")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Settings/i }),
    ).toBeInTheDocument();
  });

  it("uses the canonical mobile sheet menu on touch layouts", async () => {
    isDesktop = false;
    canHover = false;
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "User menu" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".listen-glass-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Settings/i }),
    ).toBeInTheDocument();
  });
});
