import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { ShowSourceImport } from "./ShowSourceImport";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function imageApi() {
  const uploads: ReturnType<typeof deferred<{ upload_id: string }>>[] = [];
  vi.mocked(api).mockImplementation(async (url) => {
    if (url.endsWith("/availability"))
      return { configured: false, ocr: { available: true } };
    if (url.endsWith("/drafts")) return { items: [] };
    if (url.endsWith("/uploads")) {
      const upload = deferred<{ upload_id: string }>();
      uploads.push(upload);
      return upload.promise;
    }
    if (url.endsWith("/extractions")) return { job_id: "images" };
    if (url.endsWith("/jobs/images"))
      return {
        status: "completed",
        result: { draft: { candidates: [], coverage: "incomplete" } },
      };
    throw new Error(url);
  });
  return uploads;
}

it("uses the current close callback without refetching when its identity changes", async () => {
  imageApi();
  const onDraft = vi.fn();
  const firstCallback = vi.fn();
  const nextCallback = vi.fn();
  const { rerender } = render(
    <ShowSourceImport open onDraft={onDraft} onBusyChange={firstCallback} />,
  );
  await screen.findByText(/OCR worker: ready/);
  rerender(
    <ShowSourceImport open onDraft={onDraft} onBusyChange={nextCallback} />,
  );
  expect(
    vi.mocked(api).mock.calls.filter(([url]) => url.endsWith("/availability")),
  ).toHaveLength(1);
  rerender(
    <ShowSourceImport
      open={false}
      onDraft={onDraft}
      onBusyChange={nextCallback}
    />,
  );
  expect(nextCallback).toHaveBeenCalledWith(false);
  expect(firstCallback).not.toHaveBeenCalled();
});

it("creates a readiness key on demand and reuses it after an uncertain acceptance", async () => {
  imageApi();
  const original = vi.mocked(api).getMockImplementation()!;
  let failed = false;
  vi.mocked(api).mockImplementation(async (...args) => {
    if (args[0].endsWith("/extractions") && !failed) {
      failed = true;
      throw new Error("Acceptance response lost");
    }
    return original(...args);
  });
  renderWithAdminProviders(<ShowSourceImport open onDraft={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Check worker readiness" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Resume same extraction" }),
  );
  await screen.findByText(/0 candidates/);
  const requests = vi
    .mocked(api)
    .mock.calls.filter(([url]) => url.endsWith("/extractions"));
  expect(requests).toHaveLength(2);
  expect(requests[0]![2]).toEqual(
    expect.objectContaining({
      mode: "probe",
      idempotency_key: expect.any(String),
    }),
  );
  expect(requests[1]![2]).toEqual(requests[0]![2]);
});

it("keeps each image row mounted when an earlier image with the same name is removed", async () => {
  imageApi();
  renderWithAdminProviders(<ShowSourceImport open onDraft={vi.fn()} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Images (up to 3)"), [
    new File(["first"], "flyer.png", { type: "image/png" }),
    new File(["second"], "flyer.png", { type: "image/png" }),
  ]);
  const retained = screen.getByRole("button", {
    name: "Remove image 2",
  }).parentElement;
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  expect(
    screen.getByRole("button", { name: "Remove image 1" }).parentElement,
  ).toBe(retained);
});

it("uploads the bounded image selection concurrently and preserves source order", async () => {
  const uploads = imageApi();
  const onDraft = vi.fn();
  renderWithAdminProviders(<ShowSourceImport open onDraft={onDraft} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Images (up to 3)"), [
    new File(["first"], "first.png", { type: "image/png" }),
    new File(["second"], "second.png", { type: "image/png" }),
    new File(["third"], "third.png", { type: "image/png" }),
  ]);
  await user.click(screen.getByRole("button", { name: "Extract candidates" }));
  expect(uploads).toHaveLength(3);
  await act(async () => {
    uploads[2]!.resolve({ upload_id: "third" });
    uploads[0]!.resolve({ upload_id: "first" });
  });
  expect(onDraft).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Extract candidates" }),
  ).toBeDisabled();
  await act(async () => uploads[1]!.resolve({ upload_id: "second" }));
  await waitFor(() => expect(onDraft).toHaveBeenCalledOnce());
  expect(
    vi
      .mocked(api)
      .mock.calls.find(([url]) => url.endsWith("/extractions"))?.[2],
  ).toEqual(
    expect.objectContaining({ upload_ids: ["first", "second", "third"] }),
  );
});

it("waits for every upload after a failure before unlocking the draft", async () => {
  const uploads = imageApi();
  renderWithAdminProviders(<ShowSourceImport open onDraft={vi.fn()} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Images (up to 3)"), [
    new File(["first"], "first.png", { type: "image/png" }),
    new File(["second"], "second.png", { type: "image/png" }),
  ]);
  await user.click(screen.getByRole("button", { name: "Extract candidates" }));
  expect(uploads).toHaveLength(2);
  await act(async () => uploads[0]!.reject(new Error("Upload unavailable")));
  expect(
    screen.getByRole("button", { name: "Extract candidates" }),
  ).toBeDisabled();
  await act(async () => uploads[1]!.resolve({ upload_id: "second" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Upload unavailable",
  );
  expect(
    screen.getByRole("button", { name: "Extract candidates" }),
  ).not.toBeDisabled();
  expect(
    vi.mocked(api).mock.calls.some(([url]) => url.endsWith("/extractions")),
  ).toBe(false);
});

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

it.each(["vision", "text_llm", "ocr_text_llm"])(
  "uses %s model and its own exact source consent",
  async (method) => {
    const actions = Object.fromEntries(
      ["vision", "text_llm", "ocr_text_llm"].map((mode) => [
        mode,
        {
          configured: true,
          model: `${mode}-model`,
          configuration_fingerprint: `${mode}-fingerprint`,
          connectivity: "not_checked",
          vision: "unknown",
        },
      ]),
    );
    vi.mocked(api).mockImplementation(async (url) => {
      if (url.endsWith("/availability"))
        return {
          configured: true,
          model: "wrong-global",
          configuration_fingerprint: "wrong-global-fingerprint",
          connectivity: "not_checked",
          vision: "unknown",
          actions,
          ocr: { available: true },
        };
      if (url.endsWith("/drafts")) return { items: [] };
      if (url.endsWith("/uploads")) return { upload_id: "image" };
      if (url.endsWith("/extractions")) return { job_id: "own-model" };
      if (url.endsWith("/jobs/own-model"))
        return {
          status: "completed",
          result: { draft: { candidates: [], coverage: "incomplete" } },
        };
      throw new Error(url);
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<ShowSourceImport open onDraft={vi.fn()} />);
    await screen.findByText(/OCR worker: ready/);
    await user.selectOptions(
      screen.getByLabelText("Extraction method"),
      method,
    );
    await user.type(screen.getByLabelText("Source text"), "Tour text");
    if (method !== "text_llm")
      await user.upload(
        screen.getByLabelText("Images (up to 3)"),
        new File(["image"], "flyer.png", { type: "image/png" }),
      );
    expect(screen.getByText(new RegExp(`LLM: ${method}-model`))).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Extract candidates" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/show-imports/extractions",
        "POST",
        expect.objectContaining({
          mode: method,
          expected_model: `${method}-model`,
          expected_configuration: `${method}-fingerprint`,
        }),
        expect.anything(),
      ),
    );
  },
);
it("keeps available vision independent of unavailable text actions", async () => {
  vi.mocked(api).mockImplementation(async (url) =>
    url.endsWith("/availability")
      ? {
          configured: false,
          ocr: { available: true },
          actions: {
            vision: {
              configured: true,
              model: "vision-only",
              configuration_fingerprint: "vision-only-fingerprint",
              vision: "unknown",
              connectivity: "not_checked",
            },
            text_llm: { configured: false },
            ocr_text_llm: { configured: false },
          },
        }
      : { items: [] },
  );
  renderWithAdminProviders(<ShowSourceImport open onDraft={vi.fn()} />);
  await screen.findByText(/OCR worker: ready/);
  expect(
    screen.getByRole("option", { name: "Configured model vision" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("option", { name: "Configured model from text / URL" }),
  ).toBeDisabled();
});
