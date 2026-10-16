import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { ShowSourceImport } from "./ShowSourceImport";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("keeps local text mode available and returns all tour rows for explicit selection", async () => {
  const draft = {
    raw_text: "2027-03-02\n2027-03-04",
    coverage: "incomplete",
    candidates: [
      { item_id: "a", date: "2027-03-02" },
      { item_id: "b", date: "2027-03-04" },
    ],
    warnings: ["Review every source date"],
  };
  vi.mocked(api).mockImplementation(async (url) => {
    if (url.endsWith("/availability"))
      return {
        configured: false,
        vision: "unknown",
        connectivity: "not_checked",
        ocr: { available: true },
      };
    if (url.endsWith("/drafts")) return { items: [] };
    if (url.endsWith("/extractions")) return { job_id: "extract1" };
    if (url.endsWith("/jobs/extract1"))
      return {
        status: "completed",
        result: { draft, execution: { draft_id: "d" } },
      };
    throw new Error(url);
  });
  const onDraft = vi.fn();
  renderWithAdminProviders(<ShowSourceImport open onDraft={onDraft} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Extraction method"), "parse");
  await user.type(screen.getByLabelText("Source text"), draft.raw_text);
  await user.click(screen.getByRole("button", { name: "Extract candidates" }));
  expect(await screen.findByText(/2 candidates/)).toBeInTheDocument();
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      candidates: expect.arrayContaining([
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
      ]),
    }),
  );
  expect(
    vi
      .mocked(api)
      .mock.calls.find(([url]) => url.endsWith("/extractions"))?.[2],
  ).toEqual(expect.objectContaining({ mode: "parse" }));
});
