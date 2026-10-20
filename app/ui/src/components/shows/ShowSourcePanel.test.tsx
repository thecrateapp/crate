import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { reasonText } from "@/lib/ai-models";
import { ShowSourcePanel } from "./ShowSourcePanel";
import type { ShowAvailability, ShowDraft } from "./show-import-types";
import { useShowSource } from "./use-show-source";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

type ApiArgs = [
  url: string,
  method?: string,
  body?: unknown,
  options?: { signal?: AbortSignal },
];
type Route = (...args: ApiArgs) => unknown;
type RouteName =
  | "availability"
  | "drafts"
  | "draft"
  | "uploads"
  | "extractions"
  | "jobs"
  | "cancel";

const MODEL = "gemini/gemini-3.8-flash";
const CONFIGURED = {
  configured: true,
  model: MODEL,
  provider: "gemini",
  configuration_fingerprint: "fp-1",
  reason: null,
};
const LIMIT_TEXT =
  "Use up to 3 PNG, JPEG or WebP images, each up to 8 MB and 20 megapixels.";

function availability(
  overrides: Partial<ShowAvailability> = {},
): ShowAvailability {
  return {
    ocr: { available: true },
    checked_at: "2026-10-20T10:00:00Z",
    actions: {
      vision: { ...CONFIGURED },
      text_llm: { ...CONFIGURED },
      ocr_text_llm: { ...CONFIGURED },
    },
    ...overrides,
  };
}

function stale(): ShowAvailability {
  return availability({
    checked_at: undefined,
    ocr: { available: false, reason: "Worker readiness not checked yet" },
  });
}

function routeOf(url: string): RouteName | null {
  if (url.endsWith("/availability")) return "availability";
  if (url.endsWith("/drafts")) return "drafts";
  if (url.includes("/drafts/")) return "draft";
  if (url.endsWith("/uploads")) return "uploads";
  if (url.endsWith("/extractions")) return "extractions";
  if (url.endsWith("/cancel")) return "cancel";
  if (url.includes("/jobs/")) return "jobs";
  return null;
}

function sourceApi(routes: Partial<Record<RouteName, Route>> = {}) {
  let uploads = 0;
  const defaults: Partial<Record<RouteName, Route>> = {
    availability: () => availability(),
    drafts: () => ({ items: [] }),
    uploads: () => ({ upload_id: `upload-${++uploads}` }),
    extractions: (_url, _method, body) => ({
      job_id: (body as { mode: string }).mode === "probe" ? "probe-1" : "job-1",
    }),
    jobs: (url) => ({
      job_id: url.split("/").pop(),
      status: "completed",
      result: {
        draft: { raw_text: "", candidates: [], coverage: "incomplete" },
      },
    }),
  };
  vi.mocked(api).mockImplementation(async (...args: ApiArgs) => {
    const name = routeOf(args[0]);
    const handler = name ? (routes[name] ?? defaults[name]) : undefined;
    if (!handler) throw new Error(`Unexpected request ${args[0]}`);
    return handler(...args);
  });
}

function requests(fragment: string, method = "GET") {
  return vi
    .mocked(api)
    .mock.calls.filter(
      ([url, verb = "GET"]) => url.includes(fragment) && verb === method,
    );
}

function extractionBodies() {
  return requests("/extractions", "POST").map(
    ([, , body]) => body as Record<string, unknown>,
  );
}

function probeBodies() {
  return extractionBodies().filter((body) => body.mode === "probe");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function png(name = "flyer.png") {
  return new File([name], name, { type: "image/png" });
}

function Harness({
  active = true,
  onDraft = vi.fn(),
}: {
  active?: boolean;
  onDraft?: (draft: ShowDraft) => void;
}) {
  const source = useShowSource({ active, onDraft });
  return <ShowSourcePanel source={source} />;
}

function radio(name: string) {
  return screen.getByRole("radio", { name });
}

it("loads availability once per activation and stops waiting when deactivated", async () => {
  let waitSignal: AbortSignal | undefined;
  sourceApi({
    jobs: (_url, _method, _body, options) => {
      waitSignal = options?.signal;
      return new Promise(() => {});
    },
  });
  const user = userEvent.setup();
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  rerender(<Harness onDraft={vi.fn()} />);
  expect(requests("/availability")).toHaveLength(1);
  await user.type(screen.getByLabelText("Pasted text"), "2027-03-02 Sala");
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  await waitFor(() => expect(waitSignal).toBeDefined());
  rerender(<Harness active={false} />);
  expect(waitSignal!.aborted).toBe(true);
  rerender(<Harness />);
  expect(
    await screen.findByRole("button", { name: "Retry import" }),
  ).toBeEnabled();
  await waitFor(() => expect(requests("/availability")).toHaveLength(2));
});

it("lets the editor retry a lost readiness acceptance with the same key", async () => {
  let attempts = 0;
  sourceApi({
    availability: () => stale(),
    extractions: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Acceptance response lost");
      return { job_id: "probe-1" };
    },
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(probeBodies()).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(
    await screen.findByText("Couldn't check the OCR worker"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(probeBodies()).toHaveLength(2));
  const [first, second] = probeBodies();
  expect(first).toEqual(
    expect.objectContaining({
      mode: "probe",
      idempotency_key: expect.stringMatching(/^readiness-\d+$/),
    }),
  );
  expect(second).toEqual(first);
});

it("keeps each image row mounted when an earlier image with the same name is removed", async () => {
  sourceApi();
  const user = userEvent.setup();
  render(<Harness />);
  await user.upload(screen.getByLabelText("Images"), [
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
  const uploads: ReturnType<typeof deferred<{ upload_id: string }>>[] = [];
  sourceApi({
    uploads: () => {
      const upload = deferred<{ upload_id: string }>();
      uploads.push(upload);
      return upload.promise;
    },
  });
  const onDraft = vi.fn();
  const user = userEvent.setup();
  render(<Harness onDraft={onDraft} />);
  await user.upload(screen.getByLabelText("Images"), [
    png("first.png"),
    png("second.png"),
    png("third.png"),
  ]);
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  expect(uploads).toHaveLength(3);
  await act(async () => {
    uploads[2]!.resolve({ upload_id: "third" });
    uploads[0]!.resolve({ upload_id: "first" });
  });
  expect(onDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Find dates" })).toBeDisabled();
  await act(async () => uploads[1]!.resolve({ upload_id: "second" }));
  await waitFor(() => expect(onDraft).toHaveBeenCalledOnce());
  expect(extractionBodies()[0]).toEqual(
    expect.objectContaining({
      mode: "ocr",
      upload_ids: ["first", "second", "third"],
    }),
  );
});

it("waits for every upload after a failure before unlocking the draft", async () => {
  const uploads: ReturnType<typeof deferred<{ upload_id: string }>>[] = [];
  sourceApi({
    uploads: () => {
      const upload = deferred<{ upload_id: string }>();
      uploads.push(upload);
      return upload.promise;
    },
  });
  const user = userEvent.setup();
  render(<Harness />);
  await user.upload(screen.getByLabelText("Images"), [
    png("first.png"),
    png("second.png"),
  ]);
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  expect(uploads).toHaveLength(2);
  await act(async () => uploads[0]!.reject(new Error("Upload unavailable")));
  expect(screen.getByRole("button", { name: "Find dates" })).toBeDisabled();
  await act(async () => uploads[1]!.resolve({ upload_id: "second" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Upload unavailable");
  expect(alert.textContent).not.toContain("{");
  expect(screen.getByRole("button", { name: "Find dates" })).toBeEnabled();
  expect(requests("/extractions", "POST")).toHaveLength(0);
});

it("finds dates in pasted text without AI and returns every row", async () => {
  const draft = {
    raw_text: "2027-03-02\n2027-03-04",
    coverage: "incomplete",
    candidates: [
      { item_id: "a", date: "2027-03-02" },
      { item_id: "b", date: "2027-03-04" },
    ],
    warnings: ["Review every source date", "Review every source date"],
  };
  sourceApi({
    jobs: () => ({
      job_id: "job-1",
      status: "completed",
      result: { draft, execution: { status: "completed", draft_id: "d" } },
    }),
  });
  const onDraft = vi.fn();
  const user = userEvent.setup();
  render(<Harness onDraft={onDraft} />);
  await user.type(screen.getByLabelText("Pasted text"), draft.raw_text);
  expect(radio("Text rules")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  await screen.findByText(/Found 2 shows/);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Found 2 shows. Compare each one with the source; only the shows you select are saved. The source may list shows that were not found.",
  );
  expect(screen.getAllByText("Review every source date")).toHaveLength(1);
  expect(extractionBodies()[0]).toEqual(
    expect.objectContaining({
      mode: "parse",
      expected_model: null,
      expected_configuration: null,
    }),
  );
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      draft_id: "d",
      candidates: [
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
      ],
    }),
  );
});

it.each(["vision", "text_llm", "ocr_text_llm"] as const)(
  "uses %s with its own exact model consent",
  async (mode) => {
    const titles = {
      vision: "AI image reading",
      text_llm: "AI text reading",
      ocr_text_llm: "Local OCR + AI",
    };
    const actions = Object.fromEntries(
      (["vision", "text_llm", "ocr_text_llm"] as const).map((action) => [
        action,
        {
          configured: true,
          model: `${action}-model`,
          configuration_fingerprint: `${action}-fingerprint`,
        },
      ]),
    );
    sourceApi({
      availability: () => ({
        ...availability({ actions }),
        configured: true,
        model: "wrong-global",
        configuration_fingerprint: "wrong-global",
      }),
    });
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(requests("/availability")).toHaveLength(1));
    if (mode === "text_llm")
      await user.type(screen.getByLabelText("Pasted text"), "Tour text");
    else await user.upload(screen.getByLabelText("Images"), png());
    await user.click(radio(titles[mode]));
    expect(radio(titles[mode])).toBeChecked();
    expect(screen.getByText(`AI · ${mode}-model`)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Find dates" }));
    await waitFor(() => expect(extractionBodies()).toHaveLength(1));
    expect(extractionBodies()[0]).toEqual(
      expect.objectContaining({
        mode,
        expected_model: `${mode}-model`,
        expected_configuration: `${mode}-fingerprint`,
      }),
    );
  },
);

it("keeps available vision independent of unavailable text actions", async () => {
  sourceApi({
    availability: () =>
      availability({
        actions: {
          vision: { ...CONFIGURED, model: "vision-only" },
          text_llm: { configured: false, reason: "AI_ACTION_DISABLED" },
          ocr_text_llm: { configured: false, reason: "AI_ACTION_DISABLED" },
        },
      }),
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(radio("AI image reading")).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  await user.type(screen.getByLabelText("Pasted text"), "Tour text");
  expect(radio("AI text reading")).toBeDisabled();
  expect(
    screen.getByText(reasonText("AI_ACTION_DISABLED")),
  ).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Manage in AI models" });
  expect(link).toHaveAttribute("href", "/ai");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer");
});

it("labels local OCR as free and never says the model is not configured", async () => {
  sourceApi();
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(radio("Local OCR")).toBeChecked();
  expect(screen.getByText("Free · local OCR")).toBeVisible();
  expect(screen.queryByText(/not configured/i)).toBeNull();
  const badges = screen.getAllByText("AI · gemini-3.8-flash");
  expect(badges).toHaveLength(2);
  for (const badge of badges) expect(badge).toHaveAttribute("title", MODEL);
  await user.click(radio("AI image reading"));
  expect(
    screen.getByText(/Sends the image to gemini-3.8-flash once/),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  await waitFor(() => expect(extractionBodies()).toHaveLength(1));
  expect(extractionBodies()[0]).toEqual(
    expect.objectContaining({
      mode: "vision",
      expected_model: MODEL,
      expected_configuration: "fp-1",
    }),
  );
});

it("never switches to an AI method on its own", async () => {
  sourceApi();
  const user = userEvent.setup();
  const view = render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  await user.click(radio("AI image reading"));
  expect(radio("AI image reading")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  await user.type(screen.getByLabelText("Pasted text"), "Tour text");
  expect(radio("Text rules")).toBeChecked();
  await user.upload(screen.getByLabelText("Images"), png());
  expect(radio("Local OCR")).toBeChecked();
  expect(radio("AI image reading")).not.toBeChecked();
  view.unmount();

  sourceApi({
    availability: () =>
      availability({ ocr: { available: false, reason: "OCR_UNAVAILABLE" } }),
  });
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(2));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(radio("Local OCR")).toBeDisabled();
  for (const option of screen.getAllByRole("radio"))
    expect(option).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Find dates" })).toBeDisabled();
});

it("refreshes the methods when the AI configuration changed before sending", async () => {
  let loads = 0;
  sourceApi({
    availability: () => {
      loads += 1;
      return loads === 1
        ? availability()
        : availability({
            actions: {
              vision: {
                ...CONFIGURED,
                model: "new-model",
                configuration_fingerprint: "fp-2",
              },
            },
          });
    },
    extractions: () => {
      throw Object.assign(
        new Error(
          JSON.stringify({
            detail:
              "The configured model changed; review it before sending the source",
          }),
        ),
        { status: 409, code: "CONFIGURATION_CHANGED" },
      );
    },
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  await user.click(radio("AI image reading"));
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The AI model changed. Check the method and try again.",
  );
  expect(await screen.findByText("AI · new-model")).toBeVisible();
  expect(requests("/availability")).toHaveLength(2);
  expect(requests("/extractions", "POST")).toHaveLength(1);
  expect(requests("/jobs/")).toHaveLength(0);
});

it("checks the worker once when readiness is stale and shows the result", async () => {
  let loads = 0;
  const probe = deferred<unknown>();
  sourceApi({
    availability: () => {
      loads += 1;
      return loads === 1 ? stale() : availability();
    },
    jobs: () => probe.promise,
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/jobs/probe-1")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(screen.getByText("Checking the OCR worker…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Find dates" })).toBeEnabled();
  await act(async () =>
    probe.resolve({
      job_id: "probe-1",
      status: "completed",
      result: { draft: { readiness: { ocr: { available: true } } } },
    }),
  );
  expect(await screen.findByText("OCR ready")).toBeVisible();
  expect(probeBodies()).toHaveLength(1);
  expect(probeBodies()[0]).toEqual({
    mode: "probe",
    upload_ids: [],
    raw_text: "",
    source_url: null,
    expected_model: null,
    expected_configuration: null,
    idempotency_key: expect.stringMatching(/^readiness-\d+$/),
  });
  for (const status of screen.queryAllByRole("status"))
    expect(status.textContent).not.toMatch(/readiness|OCR|worker/i);
  expect(screen.getByRole("button", { name: "Find dates" })).toBeEnabled();
});

it("does not check the worker when readiness is fresh", async () => {
  sourceApi();
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/drafts")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(await screen.findByText("OCR ready")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  expect(requests("/extractions", "POST")).toHaveLength(0);
});

it("reuses the running readiness check after closing and reopening", async () => {
  sourceApi({
    availability: () => stale(),
    jobs: (url) => ({ job_id: url.split("/").pop(), status: "running" }),
  });
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(requests("/jobs/probe-1")).toHaveLength(1));
  rerender(<Harness active={false} />);
  const polled = requests("/jobs/").length;
  rerender(<Harness />);
  await waitFor(() =>
    expect(requests("/jobs/").length).toBeGreaterThan(polled),
  );
  expect(requests("/availability")).toHaveLength(2);
  expect(probeBodies()).toHaveLength(1);
  for (const [url] of requests("/jobs/"))
    expect(url).toBe("/api/show-imports/jobs/probe-1");
});

it("adds dropped and pasted images and rejects more than three", async () => {
  sourceApi();
  const user = userEvent.setup();
  render(<Harness />);
  const zone = screen.getByRole("group", { name: "Source images" });
  fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
  expect(zone).toHaveAttribute("data-dragging");
  fireEvent.drop(zone, { dataTransfer: { files: [png("dropped.png")] } });
  expect(screen.getByText("dropped.png")).toBeVisible();
  expect(zone).not.toHaveAttribute("data-dragging");
  fireEvent.paste(screen.getByLabelText("Pasted text"), {
    clipboardData: { files: [png("pasted.png")] },
  });
  expect(screen.getByText("pasted.png")).toBeVisible();
  await user.upload(screen.getByLabelText("Images"), png("third.png"));
  expect(screen.getByRole("button", { name: "Remove image 3" })).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  await user.upload(screen.getByLabelText("Images"), png("fourth.png"));
  expect(screen.getByRole("alert")).toHaveTextContent(LIMIT_TEXT);
  expect(screen.queryByText("fourth.png")).toBeNull();
});

it("lists recent imports by method and size, without job ids", async () => {
  sourceApi({
    drafts: () => ({
      items: [
        {
          id: "d1",
          job_id: "job-123",
          status: "completed",
          mode: "ocr",
          candidate_count: 3,
          created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        },
      ],
    }),
  });
  const user = userEvent.setup();
  render(<Harness />);
  const toggle = await screen.findByRole("button", { name: "Recent imports" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Local OCR")).toBeVisible();
  expect(screen.getByText("3 shows found")).toBeVisible();
  expect(screen.getByRole("button", { name: "Open" })).toBeVisible();
  expect(document.body.textContent).not.toContain("job-123");
  expect(document.body.textContent).not.toContain("d1");
});

it("reopens a recent import without restoring an AI method", async () => {
  const draft = {
    raw_text: "MAR 02 SALA NORTE",
    coverage: "incomplete",
    candidates: [{ item_id: "a", date: "2027-03-02" }],
  };
  sourceApi({
    drafts: () => ({
      items: [
        {
          id: "d1",
          job_id: "job-123",
          status: "completed",
          mode: "vision",
          candidate_count: 1,
          created_at: new Date().toISOString(),
        },
      ],
    }),
    draft: () => ({
      id: "d1",
      job_id: "job-123",
      status: "completed",
      result: draft,
      input: {
        mode: "vision",
        raw_text: "",
        source_url: null,
        upload_ids: ["upload-a"],
      },
    }),
  });
  const onDraft = vi.fn();
  const user = userEvent.setup();
  render(<Harness onDraft={onDraft} />);
  await user.click(
    await screen.findByRole("button", { name: "Recent imports" }),
  );
  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(
    await screen.findByText(
      "Import reopened. Saved shows stay linked; the rest are ready to review.",
    ),
  ).toHaveAttribute("role", "status");
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ draft_id: "d1", candidates: draft.candidates }),
  );
  expect(screen.getByText("1 image from the reopened import")).toBeVisible();
  expect(radio("Local OCR")).toBeChecked();
  expect(radio("AI image reading")).not.toBeChecked();
  expect(document.body.textContent).not.toContain("upload-a");
  await user.click(
    screen.getByRole("button", { name: "Clear reopened images" }),
  );
  expect(screen.queryByText(/from the reopened import/)).toBeNull();
});

it("uses design-system controls only", async () => {
  sourceApi({
    drafts: () => ({
      items: [
        {
          id: "d1",
          job_id: "job-123",
          status: "completed",
          mode: "ocr",
          candidate_count: 3,
          created_at: new Date().toISOString(),
        },
      ],
    }),
  });
  const user = userEvent.setup();
  const { container } = render(<Harness />);
  await user.upload(screen.getByLabelText("Images"), png());
  await user.click(
    await screen.findByRole("button", { name: "Recent imports" }),
  );
  const fileInput = screen.getByLabelText("Images");
  expect(fileInput).toHaveClass("sr-only");
  expect(fileInput).toHaveAttribute("tabindex", "-1");
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  expect(
    container.querySelector(
      'select, details, pre, input[type="checkbox"]:not([aria-hidden]), input[type="radio"]:not([aria-hidden])',
    ),
  ).toBeNull();
});
