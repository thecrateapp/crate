import { render, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";

import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from "@/contexts/AuthContext";

export interface AdminRenderOptions extends Omit<RenderOptions, "wrapper"> {
  auth?: Partial<AuthContextValue>;
  route?: string;
}

export function createMockAuthUser(
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return {
    id: 1,
    email: "admin@cratemusic.app",
    name: "Admin",
    role: "admin",
    roles: ["admin"],
    ...overrides,
  };
}

export function createMockAuthValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  const user = overrides.user ?? createMockAuthUser();
  return {
    user,
    actualUser: user,
    loading: false,
    logout: vi.fn(),
    isAdmin: true,
    canAccessAdmin: true,
    hasCapability: vi.fn(() => true),
    hasAnyCapability: vi.fn(() => true),
    refetch: vi.fn(),
    rolePresets: [],
    previewRole: null,
    setPreviewRole: vi.fn(),
    clearRolePreview: vi.fn(),
    ...overrides,
  };
}

export function renderWithAdminProviders(
  ui: ReactElement,
  { auth, route = "/", ...renderOptions }: AdminRenderOptions = {},
) {
  const authValue = createMockAuthValue(auth ?? {});

  return {
    authValue,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <AuthContext.Provider value={authValue}>{ui}</AuthContext.Provider>
      </MemoryRouter>,
      renderOptions,
    ),
  };
}
