import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: vi.fn(() => ({
    available: true,
    model_id: "hero-model",
  })),
}));
import { toast } from "sonner";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { waitForTask } from "@/lib/tasks";
import { ArtistArtworkGallery } from "./ArtistArtworkGallery";

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(async () => ({ status: "completed" })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const analysis = {
  summary: "Strong editorial fit with useful negative space.",
  desktop: {
    score: 92,
    reason: "Faces remain clear.",
    focal_x: 0.7,
    focal_y: 0.4,
  },
  mobile: {
    score: 76,
    reason: "Needs a tighter crop.",
    focal_x: 0.5,
    focal_y: 0.35,
  },
};

const fanartCandidate = {
  id: "signed-candidate",
  origin: "fanart-background",
  label: "Fanart background",
  preview_url: "/candidate.jpg",
  width: 2400,
  height: 1200,
  desktop: { score: 90, label: "excellent", reason: "Wide image." },
  mobile: { score: 60, label: "poor", reason: "Wide crop." },
};

type TaskResult = Awaited<ReturnType<typeof waitForTask>>;

const asset = {
  id: 41,
  artist_id: 7,
  origin: "manual-upload",
  label: "Press photo",
  mime_type: "image/jpeg",
  width: 1800,
  height: 1200,
  checksum: "a".repeat(64),
  slots: ["avatar"],
  preview_url: "/api/artwork/artists/7/assets/41/preview",
  created_at: "2026-08-01T12:00:00+00:00",
};

describe("ArtistArtworkGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useActionLLMStatus).mockReturnValue({
      available: true,
      model_id: "hero-model",
    } as ReturnType<typeof useActionLLMStatus>);
  });

  it("shows curated assets and assigns one to any artwork slot", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "assign-1" });
        }
        return Response.json({ assets: [asset] });
      }),
    );
    const onChanged = vi.fn();

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={onChanged}
      />,
    );

    expect(await screen.findByText("Press photo")).toBeVisible();
    expect(screen.getByText("Avatar")).toBeVisible();
    expect(screen.getByText("1800 × 1200")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Use Press photo as background",
      }),
    );

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const assignment = requests.find((request) =>
      request.url.endsWith("/slots/background"),
    );
    expect(assignment?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ asset_id: 41 }),
    });
    expect(
      screen.queryByRole("button", { name: "Delete Press photo" }),
    ).not.toBeInTheDocument();
  });

  it("notifies the editor when a gallery hero source is assigned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "assign-hero" });
        }
        return Response.json({ assets: [asset] });
      }),
    );
    const onHeroChanged = vi.fn();

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={vi.fn()}
        onHeroChanged={onHeroChanged}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Use Press photo as hero mobile",
      }),
    );

    await waitFor(() => expect(onHeroChanged).toHaveBeenCalledWith("mobile"));
  });

  it("deletes an unassigned asset after confirmation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let listed = true;
    const unassignedAsset = { ...asset, slots: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "DELETE") {
          listed = false;
          return Response.json({ status: "queued", task_id: "delete-1" });
        }
        return Response.json({ assets: listed ? [unassignedAsset] : [] });
      }),
    );

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={() => undefined}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Delete Press photo" }),
    );
    expect(screen.getByText("Delete Press photo?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Delete image" }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith("/assets/41") &&
            request.init?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  it("adds an upload to the gallery without assigning it implicitly", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "import-1" });
        }
        return Response.json({ assets: [] });
      }),
    );

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={() => undefined}
      />,
    );

    await userEvent.upload(
      screen.getByLabelText("Add image to gallery"),
      new File(["image"], "press.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith("/assets/upload") &&
            request.init?.method === "POST" &&
            request.init.body instanceof FormData,
        ),
      ).toBe(true),
    );
  });

  it("discovers, analyzes and imports trusted candidates", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/hero-candidates/analyze")) {
          return Response.json(
            { task_id: "analysis-1", status: "queued", deduplicated: false },
            { status: 202 },
          );
        }
        if (url.endsWith("/assets/import-candidate")) {
          return Response.json({ status: "queued", task_id: "candidate-1" });
        }
        if (url.endsWith("/hero-candidates")) {
          return Response.json({ candidates: [fanartCandidate] });
        }
        return Response.json({ assets: [] });
      }),
    );
    vi.mocked(waitForTask).mockResolvedValueOnce({
      status: "completed",
      result: analysis,
    } as TaskResult);

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={() => undefined}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Find image candidates" }),
    );
    expect(await screen.findByText("Fanart background")).toBeVisible();
    expect(screen.getByText("Desktop 90")).toBeVisible();
    expect(screen.getByText("Mobile 60")).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Analyze Fanart background" }),
    );
    expect(
      await screen.findByText(
        "Strong editorial fit with useful negative space.",
      ),
    ).toBeVisible();
    expect(waitForTask).toHaveBeenCalledWith(
      "analysis-1",
      600_000,
      expect.any(AbortSignal),
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Add Fanart background to gallery",
      }),
    );
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith("/assets/import-candidate") &&
            request.init?.body ===
              JSON.stringify({
                candidate: "signed-candidate",
                label: "Fanart background",
              }),
        ),
      ).toBe(true),
    );
  });
});

it("disables only optional hero analysis when its own action is unavailable", async () => {
  vi.mocked(useActionLLMStatus).mockReturnValue({
    available: false,
    model_id: null,
  } as ReturnType<typeof useActionLLMStatus>);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/hero-candidates")
        ? Response.json({
            candidates: [
              {
                id: "candidate",
                origin: "fanart-background",
                label: "Candidate",
                preview_url: "/candidate.jpg",
                width: 2000,
                height: 1000,
                desktop: { score: 80, label: "good", reason: "wide" },
                mobile: { score: 60, label: "fair", reason: "crop" },
              },
            ],
          })
        : Response.json({ assets: [] }),
    ),
  );
  render(
    <ArtistArtworkGallery
      artistId={7}
      artistName="Converge"
      canEdit
      onChanged={vi.fn()}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Find image candidates" }),
  );
  expect(
    await screen.findByRole("button", { name: "Analyze Candidate" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Add Candidate to gallery" }),
  ).toBeEnabled();
  expect(useActionLLMStatus).toHaveBeenCalledWith("artwork.hero.analyze");
});

it("keeps image deletion locked until its worker confirms completion", async () => {
  let finish!: (result: Awaited<ReturnType<typeof waitForTask>>) => void;
  vi.mocked(waitForTask).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }) as ReturnType<typeof waitForTask>,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: unknown, init?: RequestInit) =>
      Response.json(
        init?.method === "DELETE"
          ? { task_id: "pending-image-delete" }
          : { assets: [{ ...asset, slots: [] }] },
      ),
    ),
  );
  render(
    <ArtistArtworkGallery
      artistId={7}
      artistName="Converge"
      canEdit
      onChanged={vi.fn()}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete Press photo" }),
  );
  const confirm = screen.getByRole("button", { name: "Delete image" });
  await userEvent.click(confirm);
  expect(confirm).toBeDisabled();
  expect(screen.getByRole("alertdialog")).toBeVisible();
  finish({ status: "completed" } as Awaited<ReturnType<typeof waitForTask>>);
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
});

function stubAnalysisFetch(analyzeResponse: () => Response) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/hero-candidates/analyze")) return analyzeResponse();
      if (url.endsWith("/hero-candidates")) {
        return Response.json({ candidates: [fanartCandidate] });
      }
      return Response.json({ assets: [] });
    }),
  );
  return requests;
}

const queuedAnalysis = () =>
  Response.json(
    { task_id: "analysis-1", status: "queued", deduplicated: false },
    { status: 202 },
  );

async function analyzeFanartCandidate() {
  await userEvent.click(
    screen.getByRole("button", { name: "Find image candidates" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Analyze Fanart background" }),
  );
}

describe("ArtistArtworkGallery queued analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useActionLLMStatus).mockReturnValue({
      available: true,
      model_id: "hero-model",
    } as ReturnType<typeof useActionLLMStatus>);
  });

  it("shows pending then the analysis without locking the gallery", async () => {
    let finish!: (result: TaskResult) => void;
    vi.mocked(waitForTask).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as ReturnType<typeof waitForTask>,
    );
    stubAnalysisFetch(queuedAnalysis);
    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={vi.fn()}
      />,
    );

    await analyzeFanartCandidate();

    expect(await screen.findByText("AI · Analyzing")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Analyze Fanart background" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add Fanart background to gallery" }),
    ).toBeEnabled();

    finish({ status: "completed", result: analysis } as TaskResult);

    expect(
      await screen.findByText(
        "Strong editorial fit with useful negative space.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Vision: desktop 92 · mobile 76")).toBeVisible();
    expect(screen.queryByText("AI · Analyzing")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Analyze Fanart background" }),
    ).toBeEnabled();
  });

  it("reports the task error when the analysis fails", async () => {
    vi.mocked(waitForTask).mockResolvedValueOnce({
      status: "failed",
      error: "Provider request could not be completed",
    } as TaskResult);
    stubAnalysisFetch(queuedAnalysis);
    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={vi.fn()}
      />,
    );

    await analyzeFanartCandidate();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Provider request could not be completed",
      ),
    );
    expect(screen.queryByText("AI · Analyzing")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Strong editorial fit with useful negative space."),
    ).not.toBeInTheDocument();
  });

  it("reports an unavailable action without waiting for a task", async () => {
    stubAnalysisFetch(() =>
      Response.json(
        { detail: "Action is disabled" },
        { status: 503, headers: { "X-Crate-Error": "AI_ACTION_DISABLED" } },
      ),
    );
    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={vi.fn()}
      />,
    );

    await analyzeFanartCandidate();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Action is disabled"),
    );
    expect(waitForTask).not.toHaveBeenCalled();
  });

  it("stops waiting for the analysis when the gallery unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(waitForTask).mockImplementationOnce(
      (_taskId, _timeoutMs, abortSignal) => {
        signal = abortSignal;
        return new Promise(() => undefined);
      },
    );
    stubAnalysisFetch(queuedAnalysis);
    const view = render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={vi.fn()}
      />,
    );

    await analyzeFanartCandidate();
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
