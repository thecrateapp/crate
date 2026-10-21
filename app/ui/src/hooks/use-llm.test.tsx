import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
import { LLMStatusProvider, useActionLLMStatus } from "./use-llm";
const unavailable = { available: false, model_id: "other" };
const eq = {
  action_id: "genres.eq.propose",
  available: true,
  status: "configured",
  provider: "gemini",
  model_id: "eq-model",
  fingerprint: "f",
  error_code: null,
};
function Consumer({ id }: { id: string }) {
  const status = useActionLLMStatus(id);
  return (
    <output aria-label={id}>
      {status?.available ? status.model_id : "unavailable"}
    </output>
  );
}
describe("action availability subscriptions", () => {
  beforeEach(() => {
    useApiMock.mockClear();
    useApiMock.mockImplementation((url: string) => ({
      data: url.includes("genres.eq.propose") ? eq : unavailable,
    }));
  });
  it("shares one reader per used action and preserves independent states", () => {
    renderWithAdminProviders(
      <LLMStatusProvider>
        <Consumer id="genres.eq.propose" />
        <Consumer id="genres.eq.propose" />
        <Consumer id="playlists.description.generate" />
      </LLMStatusProvider>,
    );
    expect(screen.getAllByLabelText("genres.eq.propose")).toHaveLength(2);
    expect(screen.getAllByLabelText("genres.eq.propose")[0]).toHaveTextContent(
      "eq-model",
    );
    expect(
      screen.getByLabelText("playlists.description.generate"),
    ).toHaveTextContent("unavailable");
    const urls = useApiMock.mock.calls.map(([url]) => url);
    expect(new Set(urls)).toEqual(
      new Set([
        "/api/admin/ai/actions/genres.eq.propose/availability",
        "/api/admin/ai/actions/playlists.description.generate/availability",
      ]),
    );
    expect(urls.filter((u) => u.includes("genres.eq.propose"))).toHaveLength(2);
  });
  it("does not read unauthorized or unused actions", () => {
    renderWithAdminProviders(
      <LLMStatusProvider>
        <Consumer id="genres.eq.propose" />
      </LLMStatusProvider>,
      { auth: { hasCapability: () => false } },
    );
    expect(screen.getByLabelText("genres.eq.propose")).toHaveTextContent(
      "unavailable",
    );
    expect(useApiMock).not.toHaveBeenCalled();
  });
});
