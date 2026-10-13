import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "@/contexts/auth-context";
import { I18nProvider } from "@/i18n";
import { shouldRedirectToLoginOnUnauthorized } from "@/lib/auth-route-policy";

import { Crate } from "@/pages/Crate";

import { AppLayoutRoute } from "./AppLayoutRoute";

const authenticatedApp = vi.hoisted(() => ({ mounts: 0 }));

vi.mock("@/app-shell/AuthenticatedApp", () => ({
  AuthenticatedApp: function AuthenticatedAppProbe() {
    useEffect(() => {
      authenticatedApp.mounts += 1;
    }, []);
    return <Outlet />;
  },
}));

const crateId = "2d89b6b2-0a62-41a4-b7aa-c2cd3dab69d6";
const publicRef = "year-end-records-c6VS1y82";

const publicCrate = {
  id: crateId,
  short_code: "c6VS1y82",
  public_ref: publicRef,
  owner_id: 7,
  owner_username: "jane",
  owner_name: "Jane Doe",
  name: "Year-end records",
  description: "Our favorite albums this year.",
  visibility: "public",
  is_collaborative: false,
  is_ordered: false,
  sort_direction: "asc",
  loop_enabled: false,
  access: "public",
  album_count: 1,
  track_count: 9,
  follower_count: 0,
  is_followed: false,
  first_album: null,
  albums: [
    {
      global_album_uid: "11111111-1111-4111-8111-111111111111",
      position: 0,
      name: "Blending",
      artist_name: "High Vis",
      year: "2022",
      has_cover: true,
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function anonymousAuth(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: null,
    loading: false,
    accessMode: "unauthenticated",
    offlineIdentity: null,
    refetch: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go {to}
    </button>
  );
}

function renderAppLayout(
  auth: AuthContextValue,
  path = `/crate/${crateId}`,
  cratePage: React.ReactNode = <Crate />,
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider initialLocale="en">
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route element={<AppLayoutRoute />}>
              <Route
                path="crate/:crateRef"
                element={
                  <>
                    {cratePage}
                    <LocationProbe />
                    <NavigateButton to="/library" />
                  </>
                }
              />
              <Route
                path="library"
                element={
                  <>
                    <div>Library page</div>
                    <NavigateButton to={`/crate/${crateId}`} />
                  </>
                }
              />
            </Route>
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthContext.Provider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("AppLayoutRoute", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (
        url.endsWith(`/api/crates/${crateId}`) ||
        url.endsWith(`/api/crates/${publicRef}`)
      ) {
        return jsonResponse(200, publicCrate);
      }
      return jsonResponse(401, { detail: "Not authenticated" });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    authenticatedApp.mounts = 0;
  });

  it("renders the public shell for anonymous visitors without redirecting to login", async () => {
    renderAppLayout(anonymousAuth());
    expect(await screen.findByTestId("public-shell")).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getAllByText("Year-end records")).not.toHaveLength(0),
      { timeout: 10000 },
    );
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/crate/${publicRef}`,
      ),
    );

    const loginLinks = screen.getAllByRole("link", { name: "Log in" });
    expect(loginLinks[0]).toHaveAttribute(
      "href",
      `/login?return_to=${encodeURIComponent(`/crate/${publicRef}`)}`,
    );
    expect(
      screen.getByRole("link", { name: "Sign in to listen" }),
    ).toHaveAttribute(
      "href",
      `/login?return_to=${encodeURIComponent(`/crate/${publicRef}`)}`,
    );

    const requested = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requested.some((url) => url.includes("/api/me/"))).toBe(false);
    expect(requested.some((url) => url.includes("/playback"))).toBe(false);
  });

  it("waits for the session check before choosing a shell", () => {
    renderAppLayout(anonymousAuth({ loading: true }));

    expect(screen.queryByTestId("public-shell")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("sends anonymous visitors on other app routes to login", async () => {
    renderAppLayout(anonymousAuth(), "/library");

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("keeps the authenticated app mounted when entering and leaving a Crate", async () => {
    renderAppLayout(
      anonymousAuth({
        user: { id: 1, email: "a@b.c", username: "a", role: "user" } as never,
        accessMode: "authenticated" as never,
      }),
      "/library",
      <div>Crate page</div>,
    );

    expect(await screen.findByText("Library page")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: `go /crate/${crateId}` }),
    );
    expect(await screen.findByText("Crate page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "go /library" }));
    expect(await screen.findByText("Library page")).toBeInTheDocument();

    expect(screen.queryByTestId("public-shell")).not.toBeInTheDocument();
    expect(authenticatedApp.mounts).toBe(1);
  });

  it("keeps public Crate routes out of the unauthorized login redirect", () => {
    expect(shouldRedirectToLoginOnUnauthorized(`/crate/${crateId}`)).toBe(
      false,
    );
    expect(shouldRedirectToLoginOnUnauthorized(`/crate/${publicRef}`)).toBe(
      false,
    );
    expect(
      shouldRedirectToLoginOnUnauthorized("/crate/invite-records-c6VS1y82"),
    ).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/crate/invite/token")).toBe(
      true,
    );
    expect(shouldRedirectToLoginOnUnauthorized("/crates")).toBe(true);
  });
});
