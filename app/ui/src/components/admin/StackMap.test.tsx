import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackMap } from "./StackMap";
import type { StackMapSnapshot } from "./stack-map-model";

function snapshot(): StackMapSnapshot {
  return {
    host: {
      id: "host",
      name: "Crate host",
      address: "192.0.2.1",
      cpuPercent: 25,
      memoryUsedGiB: 8,
      memoryTotalGiB: 32,
    },
    stacks: [
      { id: "app", name: "Crate", kind: "application", revision: "abc123" },
      {
        id: "obs",
        name: "Observability",
        kind: "observability",
        revision: "def456",
      },
    ],
    services: [
      ["crate-api", "app", "API"],
      ["readplane", "app", "Read plane"],
      ["postgres", "app", "PostgreSQL"],
      ["redis", "app", "Redis"],
      ["prometheus", "obs", "Prometheus"],
      ["grafana", "obs", "Grafana"],
    ].map(([id, stackId, label], order) => ({
      order,
      id: id!,
      stackId: stackId!,
      label: label!,
      description: `${label} service`,
      runtimeState: "running",
      health: "healthy",
      cpuPercent: 27,
      memoryMiB: 512,
    })),
    connections: [
      { source: "readplane", target: "crate-api", kind: "request" },
      { source: "crate-api", target: "postgres", kind: "data" },
      { source: "crate-api", target: "redis", kind: "queue" },
      { source: "prometheus", target: "crate-api", kind: "telemetry" },
      { source: "grafana", target: "prometheus", kind: "request" },
    ],
    availability: "available",
    observedAt: "2026-10-31T12:00:00Z",
    metricsSource: "prometheus",
  };
}

function inspector() {
  return screen.getByRole("region", { name: "Service inspector" });
}

describe("StackMap", () => {
  it("places the single inspector directly after the mobile field and before the map key and service index", () => {
    vi.stubGlobal("innerWidth", 390);
    render(<StackMap snapshot={snapshot()} />);
    const map = screen.getByRole("region", { name: "Stack topology" });
    const stage = map.querySelector(".stack-map__stage")!;
    const key = map.querySelector(".stack-map__legend")!;
    const index = map.querySelector(".stack-map__list")!;
    const detail = inspector();

    expect(
      screen.getAllByRole("region", { name: "Service inspector" }),
    ).toHaveLength(1);
    expect(
      stage.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      detail.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      key.compareDocumentPosition(index) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps default selection in the application when replacement inventory order changes", () => {
    const data = snapshot();
    data.services = data.services.map((service) => ({
      ...service,
      id: service.id === "crate-api" ? "api" : service.id,
    }));
    const { rerender } = render(<StackMap snapshot={data} />);
    expect(screen.getByRole("button", { name: "Inspect API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    rerender(
      <StackMap
        snapshot={{
          ...data,
          stacks: [...data.stacks].reverse(),
          services: [...data.services].reverse(),
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Inspect API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders both stacks and inspects API by default", () => {
    render(<StackMap snapshot={snapshot()} />);

    const map = screen.getByRole("region", { name: "Stack topology" });
    expect(map).toHaveTextContent("Crate host");
    expect(map).toHaveTextContent("Observability");
    expect(screen.getByRole("button", { name: "Inspect API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(inspector()).toHaveTextContent("API service");
    expect(
      within(inspector()).getByRole("button", { name: "Focus PostgreSQL" }),
    ).toBeInTheDocument();
  });

  it("falls back to the first service when API is absent", () => {
    const data = snapshot();
    data.services = data.services.filter(
      (service) => service.id !== "crate-api",
    );
    render(<StackMap snapshot={data} />);

    expect(
      screen.getByRole("button", { name: "Inspect Read plane" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(inspector()).toHaveTextContent("Read plane service");
  });

  it("selects services with Enter and Space", async () => {
    const user = userEvent.setup();
    render(<StackMap snapshot={snapshot()} />);
    const postgres = screen.getByRole("button", { name: "Inspect PostgreSQL" });
    postgres.focus();

    await user.keyboard("{Enter}");

    expect(postgres).toHaveAttribute("aria-pressed", "true");
    expect(inspector()).toHaveTextContent("PostgreSQL service");
    const redis = screen.getByRole("button", { name: "Inspect Redis" });
    redis.focus();

    await user.keyboard(" ");

    expect(redis).toHaveAttribute("aria-pressed", "true");
    expect(postgres).toHaveAttribute("aria-pressed", "false");
    expect(inspector()).toHaveTextContent("Redis service");
  });

  it("moves from the inspector to a related service", async () => {
    const user = userEvent.setup();
    render(<StackMap snapshot={snapshot()} />);

    await user.click(
      within(inspector()).getByRole("button", { name: "Focus PostgreSQL" }),
    );

    expect(inspector()).toHaveTextContent("PostgreSQL service");
    expect(
      screen.getByRole("button", { name: "Inspect PostgreSQL" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps selection while hover and focus preview only one-hop dependencies", () => {
    vi.useFakeTimers();
    render(<StackMap snapshot={snapshot()} />);
    const api = screen.getByRole("button", { name: "Inspect API" });
    const postgres = screen.getByRole("button", { name: "Inspect PostgreSQL" });
    const redis = screen.getByRole("button", { name: "Inspect Redis" });
    const grafana = screen.getByRole("button", { name: "Inspect Grafana" });

    fireEvent.click(api);
    expect(api).toHaveAttribute("data-active", "true");
    expect(postgres).toHaveAttribute("data-active", "true");
    expect(grafana).not.toHaveAttribute("data-active", "true");
    fireEvent.pointerEnter(postgres);
    fireEvent.focus(postgres);
    act(() => vi.advanceTimersByTime(30_000));

    expect(api).toHaveAttribute("aria-pressed", "true");
    expect(postgres).toHaveAttribute("aria-pressed", "false");
    expect(postgres).toHaveAttribute("data-active", "true");
    expect(api).toHaveAttribute("data-active", "true");
    expect(redis).not.toHaveAttribute("data-active", "true");
    expect(inspector()).toHaveTextContent("API service");

    fireEvent.pointerLeave(postgres);
    fireEvent.blur(postgres);

    expect(redis).toHaveAttribute("data-active", "true");
  });

  it("keeps a focused service highlighted when the pointer leaves it without blur", () => {
    render(<StackMap snapshot={snapshot()} />);
    const api = screen.getByRole("button", { name: "Inspect API" });
    const postgres = screen.getByRole("button", { name: "Inspect PostgreSQL" });
    const redis = screen.getByRole("button", { name: "Inspect Redis" });
    fireEvent.click(api);
    act(() => postgres.focus());
    fireEvent.pointerEnter(postgres);

    fireEvent.pointerLeave(postgres);

    expect(postgres).toHaveFocus();
    expect(postgres).toHaveAttribute("data-active", "true");
    expect(api).toHaveAttribute("data-active", "true");
    expect(redis).not.toHaveAttribute("data-active", "true");
    expect(api).toHaveAttribute("aria-pressed", "true");
  });

  it("restores keyboard focus preview after hovering a different service", () => {
    render(<StackMap snapshot={snapshot()} />);
    const api = screen.getByRole("button", { name: "Inspect API" });
    const postgres = screen.getByRole("button", { name: "Inspect PostgreSQL" });
    const redis = screen.getByRole("button", { name: "Inspect Redis" });
    fireEvent.click(api);
    act(() => postgres.focus());

    fireEvent.pointerEnter(redis);

    expect(postgres).not.toHaveAttribute("data-active", "true");
    expect(redis).toHaveAttribute("data-active", "true");
    expect(postgres).toHaveFocus();

    fireEvent.pointerLeave(redis);

    expect(postgres).toHaveFocus();
    expect(postgres).toHaveAttribute("data-active", "true");
    expect(redis).not.toHaveAttribute("data-active", "true");
    expect(api).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves explicit selection when a replacement snapshot arrives", () => {
    const { rerender } = render(<StackMap snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Redis" }));
    const next = snapshot();
    next.services.find((service) => service.id === "redis")!.description =
      "Updated Redis service";

    rerender(<StackMap snapshot={next} />);

    expect(
      screen.getByRole("button", { name: "Inspect Redis" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(inspector()).toHaveTextContent("Updated Redis service");
  });

  it.each(["stale", "unavailable"] as const)(
    "shows n/a instead of presenting %s metrics as current values",
    (availability) => {
      render(<StackMap snapshot={{ ...snapshot(), availability }} />);

      expect(inspector()).toHaveTextContent(/n\/a/i);
      expect(inspector()).not.toHaveTextContent(/27(?:\.0)?\s*%/);
      expect(inspector()).not.toHaveTextContent(/512\s*MiB/);
    },
  );

  it("distinguishes observed zero from a missing metric", () => {
    const data = snapshot();
    data.services[0]!.cpuPercent = 0;
    data.services[0]!.memoryMiB = null;
    render(<StackMap snapshot={data} />);

    expect(inspector()).toHaveTextContent(/0(?:\.0)?\s*%/);
    expect(inspector()).toHaveTextContent(/n\/a/i);
    expect(inspector()).not.toHaveTextContent(/0\s*MiB/);
  });

  it("keeps the memory reading without inventing a range when host capacity is unknown", () => {
    const data = snapshot();
    data.host.memoryTotalGiB = null;
    render(<StackMap snapshot={data} />);

    expect(inspector()).toHaveTextContent("512 MiB");
    expect(
      within(inspector()).queryByRole("meter", { name: "Memory" }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector()).getByRole("group", { name: "Memory" }),
    ).not.toHaveAttribute("aria-valuemax");
  });

  it("starts on the declared hub of the first deployment", () => {
    const data = snapshot();
    data.stacks[0]!.hubId = "readplane";
    render(<StackMap snapshot={data} />);

    expect(
      screen.getByRole("button", { name: "Inspect Read plane" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("prefers the first application service over a hub declared only in observability", () => {
    const data = snapshot();
    data.stacks[1]!.hubId = "prometheus";
    render(<StackMap snapshot={data} />);
    expect(screen.getByRole("button", { name: "Inspect API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("surfaces failing healthchecks at rest without opening the inspector", () => {
    const data = snapshot();
    data.services.find((service) => service.id === "postgres")!.health =
      "unhealthy";
    render(<StackMap snapshot={data} />);
    const map = screen.getByRole("region", { name: "Stack topology" });
    const postgres = screen.getByRole("button", { name: "Inspect PostgreSQL" });

    expect(map).toHaveTextContent("1 failing healthcheck");
    expect(map).toHaveTextContent("4 running · 3 passing · 1 failing");
    expect(postgres).toHaveAttribute("data-health", "unhealthy");
    expect(postgres).toHaveTextContent("failing");
  });

  it.each(["stale", "unavailable"] as const)(
    "keeps topology but reports health as unknown when the snapshot is %s",
    (availability) => {
      const data = { ...snapshot(), availability };
      data.services[2]!.health = "unhealthy";
      render(<StackMap snapshot={data} />);
      const map = screen.getByRole("region", { name: "Stack topology" });

      expect(map).toHaveTextContent("Health unknown");
      expect(map).not.toHaveTextContent(/failing healthcheck/);
      expect(map).not.toHaveTextContent(/\d+ running/);
      expect(
        screen.getByRole("button", { name: "Inspect PostgreSQL" }),
      ).toHaveAttribute("data-health", "unknown");
    },
  );

  it("names the connection type of every related service in the inspector", () => {
    render(<StackMap snapshot={snapshot()} />);

    expect(
      within(inspector()).getByRole("button", { name: "Focus PostgreSQL" }),
    ).toHaveTextContent("data");
    expect(
      within(inspector()).getByRole("button", { name: "Focus Redis" }),
    ).toHaveTextContent("queue");
    expect(
      within(inspector()).getByRole("button", { name: "Focus Prometheus" }),
    ).toHaveTextContent("telemetry");
  });

  it("renders and inspects the snapshot without making network requests", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("Unexpected network")));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<StackMap snapshot={snapshot()} />);

    await user.click(
      screen.getByRole("button", { name: "Inspect PostgreSQL" }),
    );
    await user.click(
      within(inspector()).getByRole("button", { name: "Focus API" }),
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /restart|stop|deploy/i }),
    ).toBeNull();
  });
});

describe("StackMap live activity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function liveSnapshot() {
    const data = snapshot();
    for (const service of data.services) {
      if (service.id === "crate-api")
        service.activity = { measures: ["requests"] };
      if (service.id === "readplane")
        service.activity = { clients: ["readplane"] };
    }
    return data;
  }

  function frame(observedAt: string) {
    return {
      schema: 1 as const,
      sequence: 3,
      observed_at: observedAt,
      window_seconds: 5,
      availability: "available" as const,
      requests: { readplane: { count: 10, errors: 0 } },
      queues: { default: { completed: 2, failed: 0 } },
      projector: { events: 1 },
      listening: 4,
      sources: { metrics: "available" },
    };
  }

  it("adds nothing when live activity is not wired", () => {
    render(<StackMap snapshot={liveSnapshot()} />);

    expect(screen.queryByText("Live activity")).toBeNull();
    expect(document.querySelector("[data-live-status]")).toBeNull();
  });

  it("shows live readings, caption totals and a load arc for a fresh frame", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:00:05Z"));
    render(
      <StackMap
        snapshot={liveSnapshot()}
        activity={frame("2026-11-01T12:00:03Z")}
      />,
    );
    const map = screen.getByRole("region", { name: "Stack topology" });

    expect(document.querySelector("[data-live-status]")).toHaveTextContent(
      "Live",
    );
    expect(map).toHaveTextContent("120 req/min · 4 listening · 2 tasks");
    expect(within(inspector()).getByText("Live activity")).toBeVisible();
    expect(inspector()).toHaveTextContent("120/min");
    expect(
      document.querySelector('.stack-map__level[data-service="crate-api"]'),
    ).not.toBeNull();
  });

  it("pauses an old frame instead of presenting it as live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:01:00Z"));
    render(
      <StackMap
        snapshot={liveSnapshot()}
        activity={frame("2026-11-01T12:00:03Z")}
      />,
    );

    expect(document.querySelector("[data-live-status]")).toHaveAttribute(
      "data-live-status",
      "paused",
    );
    expect(document.querySelector("[data-live-status]")).toHaveTextContent(
      /Paused · last/,
    );
  });

  it("reports missing live data without inventing zero activity", () => {
    render(<StackMap snapshot={liveSnapshot()} activity={null} />);
    const map = screen.getByRole("region", { name: "Stack topology" });

    expect(document.querySelector("[data-live-status]")).toHaveTextContent(
      "Live data unavailable",
    );
    expect(map).toHaveTextContent("— req/min · — listening · — tasks");
    expect(inspector()).toHaveTextContent("Live data unavailable");
  });
});
