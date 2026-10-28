import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  InstrumentChartLegend,
  InstrumentChartPoint,
  InstrumentChartReadout,
  useInstrumentChartTheme,
} from "./InstrumentChart";

vi.mock("@/hooks/use-chart-colors", () => ({
  useChartColors: () => ({
    accent: "rgb(0, 200, 220)",
    primary: "rgb(240, 240, 240)",
    secondary: "rgb(170, 170, 170)",
    subtle: "rgb(130, 130, 130)",
    border: "rgb(40, 40, 40)",
    surface: "rgb(10, 10, 10)",
    warning: "rgb(255, 190, 60)",
  }),
}));

it("uses token-resolved mono axes, quiet guides and a fine accent cursor", () => {
  let result: ReturnType<typeof useInstrumentChartTheme> | undefined;
  function Probe() {
    result = useInstrumentChartTheme();
    return null;
  }
  render(<Probe />);
  expect(result?.theme).toMatchObject({
    text: { fontFamily: "var(--font-mono-stack)" },
    axis: {
      domain: { line: { stroke: "transparent" } },
      ticks: { text: { fill: "rgb(130, 130, 130)" } },
    },
    grid: { line: { stroke: "rgb(40, 40, 40)", strokeWidth: 1 } },
    crosshair: { line: { stroke: "rgb(0, 200, 220)", strokeWidth: 1 } },
  });
  expect(result?.colors.warning).toBe("rgb(255, 190, 60)");
});

it("keeps contextual nodes hollow and fills only the selected mark", () => {
  const { container, rerender } = render(
    <svg>
      <InstrumentChartPoint color="cyan" x={10} y={20} />
    </svg>,
  );
  expect(container.querySelector("g")).toHaveAttribute(
    "transform",
    "translate(10, 20)",
  );
  expect(container.querySelector("circle")).toHaveAttribute("r", "3.5");
  expect(container.querySelector("circle")).toHaveAttribute(
    "fill",
    "var(--surface-app)",
  );
  expect(container.querySelector("circle")).toHaveAttribute(
    "stroke-width",
    "1.25",
  );
  rerender(
    <svg>
      <InstrumentChartPoint color="cyan" selected />
    </svg>,
  );
  expect(container.querySelector("g")).toHaveAttribute("data-selected", "true");
  expect(container.querySelector("circle")).toHaveAttribute("r", "5");
  expect(container.querySelector("circle")).toHaveAttribute("fill", "cyan");
});

it("renders precise readings as a wrapping definition list and preserves zero", () => {
  render(
    <InstrumentChartReadout
      label="Selected album"
      items={[
        { label: "Energy", value: 0, unit: "%" },
        { label: "Tempo", value: "—", unit: "BPM" },
      ]}
    />,
  );
  expect(
    screen.getByRole("group", { name: "Selected album" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Energy").tagName).toBe("DT");
  expect(screen.getByText("0").tagName).toBe("DD");
  expect(screen.getByText("%")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("attenuates contextual marks while keeping the selected observation prominent", () => {
  const { container, rerender } = render(
    <svg>
      <InstrumentChartPoint color="cyan" muted />
    </svg>,
  );
  expect(container.querySelector("g")).toHaveAttribute("data-muted", "true");
  rerender(
    <svg>
      <InstrumentChartPoint color="cyan" selected muted />
    </svg>,
  );
  expect(container.querySelector("g")).not.toHaveAttribute("data-muted");
  expect(container.querySelector("g")).toHaveAttribute("data-selected", "true");
});

it("distinguishes comparison series with text and stroke pattern", () => {
  const { container } = render(
    <InstrumentChartLegend
      items={[
        { id: "avg", label: "Average", color: "cyan" },
        { id: "max", label: "Maximum", color: "gray", dashed: true },
      ]}
    />,
  );
  expect(screen.getByText("Average")).toBeInTheDocument();
  expect(screen.getByText("Maximum")).toBeInTheDocument();
  expect(container.querySelector('[data-series="max"] line')).toHaveAttribute(
    "stroke-dasharray",
    "3 4",
  );
});

it("separates an accent inspector caption from its metadata labels", () => {
  render(
    <InstrumentChartReadout
      label="Audio reading"
      tone="accent"
      items={[{ label: "Album", value: "Record" }]}
    />,
  );
  expect(screen.getByText("Audio reading")).toHaveClass(
    "text-accent-action-hi",
  );
  expect(screen.getByRole("group", { name: "Audio reading" })).toHaveClass(
    "flex",
    "flex-col",
    "gap-3",
  );
});

it("reserves a complete row for the selected album title before compact metadata", () => {
  render(
    <InstrumentChartReadout
      label="Release reading"
      items={[
        { label: "Album", value: "Short", fullWidth: true },
        { label: "Year", value: "2026" },
      ]}
    />,
  );
  expect(screen.getByText("Album").parentElement).toHaveClass(
    "basis-full",
    "w-full",
  );
  expect(screen.getByText("Year").parentElement).not.toHaveClass("basis-full");
});
