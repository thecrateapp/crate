import {
  act,
  fireEvent,
  render as renderPlain,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { AuthContext } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { reasonText } from "@/lib/ai-models";
import { createMockAuthValue } from "@/test/render-with-admin-providers";
import { ShowSourcePanel } from "./ShowSourcePanel";
import type { ShowAvailability, ShowDraft } from "./show-import-types";
import { useShowSource } from "./use-show-source";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

// The capabilities the signed-in editor has; every test starts with all.
let denied = new Set<string>();
beforeEach(() => {
  vi.clearAllMocks();
  denied = new Set();
});

// A wrapper (not a wrapped element), so `rerender` keeps the providers.
function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={createMockAuthValue({
        hasCapability: (capability: string) => !denied.has(capability),
      })}
    >
      {children}
    </AuthContext.Provider>
  );
}

function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: Providers });
}

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
    configuration_fingerprint: "config-1",
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

/** Lets pending responses and the work chained on them run to completion. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Pins Date.now so every automatic check falls in one readiness window. */
function pinClock(iso = "2026-10-20T10:05:00Z") {
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(iso));
  onTestFinished(() => now.mockRestore());
}

function png(name = "flyer.png") {
  return new File([name], name, { type: "image/png" });
}

function Harness({
  active = true,
  disabled = false,
  onDraft = vi.fn(),
}: {
  active?: boolean;
  disabled?: boolean;
  onDraft?: (draft: ShowDraft) => void;
}) {
  const source = useShowSource({ active, onDraft });
  return <ShowSourcePanel source={source} disabled={disabled} />;
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
    (await screen.findAllByText("Couldn't check the OCR worker"))[0],
  ).toBeVisible();
  await user.click(screen.getAllByRole("button", { name: "Check again" })[0]!);
  await waitFor(() => expect(probeBodies()).toHaveLength(2));
  const [first, second] = probeBodies();
  expect(first).toEqual(
    expect.objectContaining({
      mode: "probe",
      idempotency_key: expect.stringMatching(/^readiness-\d+-config-1$/),
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
  for (const badge of badges) {
    expect(badge).not.toHaveAttribute("title");
    expect(badge.closest('[data-slot="tooltip-trigger"]')).toHaveAttribute(
      "tabindex",
      "0",
    );
  }
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
  // Both OCR cards read the image with the worker's OCR engine.
  expect(screen.getAllByText("Checking the OCR worker…")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Find dates" })).toBeEnabled();
  await act(async () =>
    probe.resolve({
      job_id: "probe-1",
      status: "completed",
      result: { draft: { readiness: { ocr: { available: true } } } },
    }),
  );
  expect(await screen.findAllByText("OCR ready")).toHaveLength(2);
  expect(probeBodies()).toHaveLength(1);
  expect(probeBodies()[0]).toEqual({
    mode: "probe",
    upload_ids: [],
    raw_text: "",
    source_url: null,
    expected_model: null,
    expected_configuration: null,
    idempotency_key: expect.stringMatching(/^readiness-\d+-config-1$/),
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
  expect(await screen.findAllByText("OCR ready")).toHaveLength(2);
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

it("checks the worker once more in the same window when the AI configuration changes", async () => {
  pinClock();
  let fingerprint = "config-a";
  sourceApi({
    availability: () => ({
      ...stale(),
      configuration_fingerprint: fingerprint,
    }),
  });
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(2));
  await flush();
  expect(probeBodies()).toHaveLength(1);

  // Same configuration, same window: reopening does not post again.
  rerender(<Harness active={false} />);
  rerender(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(3));
  await flush();
  expect(probeBodies()).toHaveLength(1);

  // The server reports readiness unchecked for the new configuration.
  fingerprint = "config-b";
  rerender(<Harness active={false} />);
  rerender(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(5));
  await flush();
  expect(probeBodies()).toHaveLength(2);
  const [first, second] = probeBodies();
  expect(first!.idempotency_key).toMatch(/^readiness-\d+-config-a$/);
  expect(second!.idempotency_key).toMatch(/^readiness-\d+-config-b$/);
  const windowOf = (key: unknown) => String(key).split("-")[1];
  expect(windowOf(second!.idempotency_key)).toBe(
    windowOf(first!.idempotency_key),
  );

  // Once per configuration: reopening again does not post a third probe.
  rerender(<Harness active={false} />);
  rerender(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(6));
  await flush();
  expect(probeBodies()).toHaveLength(2);
});

it("replays the same configuration's check after a remount and keys a new one apart", async () => {
  pinClock();
  let fingerprint = "config-a";
  sourceApi({
    availability: () => ({
      ...stale(),
      configuration_fingerprint: fingerprint,
    }),
  });
  const mounts = [render(<Harness />)];
  await waitFor(() => expect(probeBodies()).toHaveLength(1));
  await flush();
  mounts.pop()!.unmount();
  mounts.push(render(<Harness />));
  await waitFor(() => expect(probeBodies()).toHaveLength(2));
  await flush();
  mounts.pop()!.unmount();
  fingerprint = "config-b";
  render(<Harness />);
  await waitFor(() => expect(probeBodies()).toHaveLength(3));
  const [first, replay, changed] = probeBodies().map(
    (body) => body.idempotency_key,
  );
  // The server answers a replayed key with the job it already accepted.
  expect(replay).toBe(first);
  expect(changed).not.toBe(first);
  expect(changed).toMatch(/^readiness-\d+-config-b$/);
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
  const open = screen.getByRole("button", { name: "Open Local OCR import" });
  expect(open).toBeVisible();
  expect(open).toHaveTextContent(/^Open$/);
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
  await user.click(
    screen.getByRole("button", { name: "Open AI image reading import" }),
  );
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
  for (const label of ["Pasted text", "Event link"]) {
    expect(
      screen.getByLabelText(label).closest('[data-slot="form-field"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(label).closest('[data-slot="form-field-label"]'),
    ).toHaveClass("text-text-subtle");
  }
  expect(screen.getByLabelText("Event link")).toHaveAccessibleDescription(
    "Crate fetches public pages only. If the page needs a login, paste a screenshot or its text instead.",
  );
  expect(
    screen.getByRole("button", { name: "Remove image 1" }),
  ).toHaveAttribute("data-size", "icon-lg");
  expect(container.querySelector("[title]")).toBeNull();
  expect(fileInput).toHaveClass("sr-only");
  expect(fileInput).toHaveAttribute("tabindex", "-1");
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  expect(
    container.querySelector(
      'select, details, pre, input[type="checkbox"]:not([aria-hidden]), input[type="radio"]:not([aria-hidden])',
    ),
  ).toBeNull();
});

it("forgets a failed readiness check once fresh availability arrives", async () => {
  let loads = 0;
  sourceApi({
    availability: () =>
      ++loads === 1
        ? stale()
        : availability({
            ocr: { available: false, reason: "OCR_UNAVAILABLE" },
          }),
    extractions: () => {
      throw new Error("Acceptance response lost");
    },
  });
  const user = userEvent.setup();
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(probeBodies()).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(
    (await screen.findAllByText("Couldn't check the OCR worker"))[0],
  ).toBeVisible();
  rerender(<Harness active={false} />);
  rerender(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(2));
  expect((await screen.findAllByText("OCR unavailable"))[0]).toBeVisible();
  expect(screen.queryByText("Couldn't check the OCR worker")).toBeNull();
  expect(radio("Local OCR")).toBeDisabled();
  for (const option of screen.getAllByRole("radio"))
    expect(option).not.toBeChecked();
  expect(probeBodies()).toHaveLength(1);
});

it("replays an aborted readiness acceptance with the same key when reopened", async () => {
  sourceApi({
    availability: () => stale(),
    extractions: (_url, _method, _body, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Closed", "AbortError")),
        ),
      ),
  });
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(probeBodies()).toHaveLength(1));
  rerender(<Harness active={false} />);
  rerender(<Harness />);
  await waitFor(() => expect(probeBodies()).toHaveLength(2));
  const [first, second] = probeBodies();
  expect(second!.idempotency_key).toBe(first!.idempotency_key);
});

it("explains when the import methods can't load and lets the editor try again", async () => {
  let loads = 0;
  sourceApi({
    availability: () => {
      loads += 1;
      if (loads === 1) throw new Error("Service unavailable");
      return availability();
    },
  });
  const user = userEvent.setup();
  render(<Harness />);
  await user.upload(screen.getByLabelText("Images"), png());
  expect(
    await screen.findByText("Couldn't load the import methods."),
  ).toBeVisible();
  expect(screen.queryByText("Checking the OCR worker…")).toBeNull();
  expect(screen.queryByText("Checking AI models…")).toBeNull();
  expect(screen.getByRole("button", { name: "Find dates" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect((await screen.findAllByText("OCR ready"))[0]).toBeVisible();
  expect(radio("Local OCR")).toBeChecked();
  expect(screen.queryByText("Couldn't load the import methods.")).toBeNull();
});

it("describes each method radio by its cost and why it is off", async () => {
  sourceApi({
    availability: () =>
      availability({
        actions: {
          vision: { configured: false, reason: "AI_ACTION_DISABLED" },
          ocr_text_llm: { ...CONFIGURED },
        },
      }),
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(radio("Local OCR")).toHaveAccessibleDescription(
    "Reads the image on your server. Nothing leaves Crate. Free · local OCR",
  );
  expect(radio("AI image reading")).toHaveAccessibleDescription(
    `Sends the poster or screenshot to the AI model. AI ${reasonText("AI_ACTION_DISABLED")}`,
  );
});

it("does not highlight the drop zone while the panel is locked", () => {
  sourceApi();
  render(<Harness disabled />);
  const zone = screen.getByRole("group", { name: "Source images" });
  fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
  expect(zone).not.toHaveAttribute("data-dragging");
  fireEvent.drop(zone, { dataTransfer: { files: [png("dropped.png")] } });
  expect(screen.queryByText("dropped.png")).toBeNull();
});

it("keeps the status region in the accessibility tree and headings in order", async () => {
  sourceApi({
    jobs: () => ({
      job_id: "job-1",
      status: "completed",
      result: {
        draft: {
          raw_text: "x",
          coverage: "incomplete",
          candidates: [{ item_id: "a", date: "2027-03-02" }],
          warnings: ["Check the year"],
        },
      },
    }),
  });
  const user = userEvent.setup();
  render(<Harness />);
  const status = screen.getByRole("status");
  expect(status).toBeEmptyDOMElement();
  expect(status.className.split(/\s+/)).not.toContain("empty:hidden");
  await user.type(screen.getByLabelText("Pasted text"), "x");
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  expect(
    await screen.findByRole("heading", { level: 3, name: "Notes" }),
  ).toBeVisible();
});

function methodCard(name: string) {
  // The radio sits in the card's title row; the card holds its badges.
  return radio(name).parentElement!.parentElement!;
}

it("shows the OCR status and «Check again» on Local OCR + AI too", async () => {
  sourceApi({
    availability: () => stale(),
    extractions: () => {
      throw Object.assign(new Error("Busy"), { status: 429 });
    },
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(probeBodies()).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  const card = methodCard("Local OCR + AI");
  expect(await within(card).findByText("OCR not checked")).toBeVisible();
  await user.click(within(card).getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(probeBodies()).toHaveLength(2));
  expect(
    within(methodCard("Local OCR")).getByText("OCR not checked"),
  ).toBeVisible();
});

it("links AI models only for editors who can open it", async () => {
  denied = new Set(["ai.config.read"]);
  sourceApi({
    availability: () =>
      availability({
        actions: {
          vision: { configured: false, reason: "AI_ACTION_DISABLED" },
          ocr_text_llm: { ...CONFIGURED },
        },
      }),
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  const card = methodCard("AI image reading");
  expect(
    within(card).getByText(reasonText("AI_ACTION_DISABLED")),
  ).toBeVisible();
  expect(
    within(card).getByText("An admin can turn this on in AI models."),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Manage in AI models" }),
  ).toBeNull();
});

it("keeps only the editor's own text in «Pasted text» after an import", async () => {
  const recognized = {
    raw_text: "MAR 02 SALA NORTE\nMAR 04 SALA SUR",
    coverage: "incomplete",
    candidates: [
      { item_id: "a", date: "2027-03-02" },
      { item_id: "b", date: "2027-03-04" },
    ],
  };
  sourceApi({
    jobs: (url) => ({
      job_id: url.split("/").pop(),
      status: "completed",
      result: {
        draft: recognized,
        execution: { status: "completed", draft_id: "d" },
      },
    }),
  });
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  expect(radio("Local OCR")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  await screen.findByText(/Found 2 shows/);
  expect(screen.getByLabelText("Pasted text")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  await waitFor(() => expect(extractionBodies()).toHaveLength(2));
  expect(extractionBodies()[1]).toEqual(
    expect.objectContaining({ mode: "ocr", raw_text: "" }),
  );

  await user.type(screen.getByLabelText("Pasted text"), "Tour: March");
  await user.click(screen.getByRole("button", { name: "Find dates" }));
  await waitFor(() => expect(extractionBodies()).toHaveLength(3));
  await screen.findByText(/Found 2 shows/);
  expect(screen.getByLabelText("Pasted text")).toHaveValue("Tour: March");
});

it.each([
  ["the editor's pasted text", { raw_text: "My notes" }, "My notes"],
  ["nothing the editor pasted", { raw_text: "" }, ""],
  ["no stored input", null, ""],
] as const)(
  "reopens an import with %s in «Pasted text»",
  async (_name, input, expected) => {
    sourceApi({
      drafts: () => ({
        items: [
          {
            id: "d1",
            job_id: "job-123",
            status: "completed",
            mode: "ocr",
            candidate_count: 1,
            created_at: new Date().toISOString(),
          },
        ],
      }),
      draft: () => ({
        id: "d1",
        job_id: "job-123",
        status: "completed",
        result: {
          raw_text: "TEXT CRATE READ",
          coverage: "incomplete",
          candidates: [{ item_id: "a", date: "2027-03-02" }],
        },
        ...(input
          ? {
              input: {
                mode: "ocr",
                source_url: null,
                upload_ids: [],
                ...input,
              },
            }
          : {}),
      }),
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Pasted text"), "Typed before");
    await user.click(
      await screen.findByRole("button", { name: "Recent imports" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open Local OCR import" }),
    );
    await screen.findByText(
      "Import reopened. Saved shows stay linked; the rest are ready to review.",
    );
    expect(screen.getByLabelText("Pasted text")).toHaveValue(expected);
  },
);

it("says what an image method sends besides the image", async () => {
  sourceApi();
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await user.upload(screen.getByLabelText("Images"), png());
  await user.type(screen.getByLabelText("Pasted text"), "Tour text");
  await user.click(radio("AI image reading"));
  expect(
    screen.getByText(
      "Sends the image and your pasted text to gemini-3.8-flash once. This counts toward your AI usage.",
    ),
  ).toBeVisible();
  await user.type(screen.getByLabelText("Event link"), "https://venue.test/x");
  await user.click(radio("Local OCR + AI"));
  expect(
    screen.getByText(
      "Sends the text read from the image, your pasted text and the linked page's text to gemini-3.8-flash once. The image stays on your server. This counts toward your AI usage.",
    ),
  ).toBeVisible();
});

it("exposes a method's configured model through the shared keyboard tooltip", async () => {
  sourceApi();
  render(<Harness />);
  await waitFor(() => expect(requests("/availability")).toHaveLength(1));
  await userEvent.upload(screen.getByLabelText("Images"), png());
  const card = methodCard("AI image reading");
  const cost = card.querySelector(
    '[data-slot="tooltip-trigger"][tabindex="0"]',
  );
  if (!(cost instanceof HTMLElement))
    throw new Error("Configured model tooltip trigger is missing");
  expect(cost).not.toHaveAttribute("title");
  cost.focus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(MODEL);
});
