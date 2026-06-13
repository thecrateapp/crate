import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ArchiveDown as SolarArchiveDownOutline,
  Cassette2 as SolarCassette2Outline,
  Heart as SolarHeartOutline,
  Microphone as SolarMicrophoneOutline,
  Pulse as SolarPulseOutline,
  Radar2 as SolarRadar2Outline,
} from "@solar-icons/react-perf/Outline";
import {
  ArchiveDown as SolarArchiveDownBold,
  Heart as SolarHeartBold,
  Pause as SolarPauseBold,
} from "@solar-icons/react-perf/Bold";

import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  BarChart3,
  Collection,
  Heart,
  HeartBold,
  Loader2,
  Pause,
  Play,
  Radio,
  Radar,
} from "./index";

function renderSvgInner(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.querySelector("svg")?.innerHTML;
}

describe("@crate/ui/icons", () => {
  it("maps size to svg dimensions", () => {
    const { container } = render(<Play size={32} />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it("lets explicit dimensions override size", () => {
    const { container } = render(<Play size={32} width={18} height={20} />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "20");
  });

  it("keeps compatibility aliases renderable", () => {
    const { container } = render(<Loader2 className="animate-spin" />);

    expect(container.querySelector("svg")).toHaveClass("animate-spin");
  });

  it("uses Solar Outline as the default visual style", () => {
    expect(renderSvgInner(<Heart size={24} />)).toBe(
      renderSvgInner(<SolarHeartOutline size={24} />),
    );
  });

  it("exposes Solar Bold variants for active states", () => {
    expect(renderSvgInner(<HeartBold size={24} />)).toBe(
      renderSvgInner(<SolarHeartBold size={24} />),
    );
    expect(renderSvgInner(<ArrowDownToLineBold size={24} />)).toBe(
      renderSvgInner(<SolarArchiveDownBold size={24} />),
    );
  });

  it("maps Crate semantic aliases to the agreed icon language", () => {
    expect(renderSvgInner(<Pause size={24} />)).toBe(
      renderSvgInner(<SolarPauseBold size={24} />),
    );
    expect(renderSvgInner(<BarChart3 size={24} />)).toBe(
      renderSvgInner(<SolarPulseOutline size={24} />),
    );
    expect(renderSvgInner(<Radar size={24} />)).toBe(
      renderSvgInner(<SolarRadar2Outline size={24} />),
    );
    expect(renderSvgInner(<Radio size={24} />)).toBe(
      renderSvgInner(<SolarMicrophoneOutline size={24} />),
    );
    expect(renderSvgInner(<ArrowDownToLine size={24} />)).toBe(
      renderSvgInner(<SolarArchiveDownOutline size={24} />),
    );
    expect(renderSvgInner(<Collection size={24} />)).toBe(
      renderSvgInner(<SolarCassette2Outline size={24} />),
    );
  });
});
