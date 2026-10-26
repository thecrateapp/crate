import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EyeIcon as SolarEyeOutline } from "@solar-icons/react/outline/eye";
import { ArchiveDownIcon as SolarArchiveDownOutline } from "@solar-icons/react/outline/archive-down";
import { Cassette2Icon as SolarCassette2Outline } from "@solar-icons/react/outline/cassette-2";
import { HeartIcon as SolarHeartOutline } from "@solar-icons/react/outline/heart";
import { MicrophoneIcon as SolarMicrophoneOutline } from "@solar-icons/react/outline/microphone";
import { MinusSquareIcon as SolarMinusSquareOutline } from "@solar-icons/react/outline/minus-square";
import { PulseIcon as SolarPulseOutline } from "@solar-icons/react/outline/pulse";
import { Radar2Icon as SolarRadar2Outline } from "@solar-icons/react/outline/radar-2";
import { ArchiveDownIcon as SolarArchiveDownBold } from "@solar-icons/react/bold/archive-down";
import { HeartIcon as SolarHeartBold } from "@solar-icons/react/bold/heart";
import { PauseIcon as SolarPauseBold } from "@solar-icons/react/bold/pause";

import {
  Eye,
  Bot,
  Toolbox,
  ArrowDownToLine,
  ArrowDownToLineBold,
  BarChart3,
  Collection,
  Heart,
  HeartBold,
  Loader2,
  Minus,
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
  it("exports the Solar Eye outline for preview actions", () => {
    expect(renderSvgInner(<Eye />)).toBe(renderSvgInner(<SolarEyeOutline />));
  });
  it("renders the official Bot Outline paths with the normal icon contract", () => {
    const { container } = render(
      <Bot size={20} aria-hidden="true" className="ai-glyph" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ fontSize: "20px" });
    expect(svg).toHaveAttribute("width", "1em");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("ai-glyph");
    expect(svg?.querySelectorAll("path")).toHaveLength(4);
  });
  it("renders the official Solar Toolbox Outline for repair actions", () => {
    const { container } = render(<Toolbox aria-hidden="true" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ fontSize: "18px" });
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg?.querySelectorAll("path")).toHaveLength(1);
    expect(svg?.querySelector("path")).toHaveAttribute("fill", "currentColor");
  });
  it("maps size to svg dimensions", () => {
    const { container } = render(<Play size={32} />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ fontSize: "32px" });
    expect(svg).toHaveAttribute("width", "1em");
  });

  it("lets explicit dimensions override size", () => {
    const { container } = render(<Play size={32} width={18} height={20} />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ width: "18px", height: "20px" });
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

  it("maps the decrement action to the Solar Minus Square outline", () => {
    expect(renderSvgInner(<Minus size={18} />)).toBe(
      renderSvgInner(<SolarMinusSquareOutline size={18} />),
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
