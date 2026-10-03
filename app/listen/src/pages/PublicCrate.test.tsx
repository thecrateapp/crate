import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "@/contexts/auth-context";
import { I18nProvider } from "@/i18n";
import { shouldRedirectToLoginOnUnauthorized } from "@/lib/auth-route-policy";

import { PublicCrate } from "./PublicCrate";

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
    refetch: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPublicCrate(auth: AuthContextValue) {
  return render(
    <MemoryRouter initialEntries={[`/crate/${crateId}`]}>
      <I18nProvider initialLocale="en">
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route
              path="/crate/:crateRef"
              element={
                <>
                  <PublicCrate />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthContext.Provider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("PublicCrate", () => {
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
  });

  it("renders the public shell for anonymous visitors without redirecting to login", async () => {
    const t0 = performance.now();
    renderPublicCrate(anonymousAuth());
    const t1 = performance.now();
    expect(await screen.findByTestId("public-shell")).toBeInTheDocument();
    const t2 = performance.now();
    let t3 = 0;
    try {
      await waitFor(
        () =>
          expect(screen.getAllByText("Year-end records")).not.toHaveLength(0),
        { timeout: 10000 },
      );
      t3 = performance.now();
    } finally {
      process.stdout.write(
        `PHASES render=${Math.round(t1 - t0)} shell=${Math.round(
          t2 - t1,
        )} title=${Math.round(
          (t3 || performance.now()) - t2,
        )} fetches=${JSON.stringify(
          fetchMock.mock.calls.map(([i]) => String(i)),
        )}\n`,
      );
    }
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
    renderPublicCrate(anonymousAuth({ loading: true }));

    expect(screen.queryByTestId("public-shell")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
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
