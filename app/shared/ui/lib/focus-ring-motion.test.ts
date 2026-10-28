import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFocusRingMotion } from "./focus-ring-motion";

const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
const focusColor = "rgb(6, 182, 212)";
const partialColor = "rgba(6, 182, 212, 0.35)";
const focusEasing = "cubic-bezier(0.22, 1.18, 0.36, 1)";

type AnimationStub = Animation & { complete: () => void };

function mediaQuery(media: string) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const query = {
    matches: false,
    media,
    addEventListener: vi.fn(
      (_: string, listener: EventListenerOrEventListenerObject) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_: string, listener: EventListenerOrEventListenerObject) =>
        listeners.delete(listener),
    ),
  };
  return {
    query,
    set(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) {
        if (typeof listener === "function") listener(new Event("change"));
        else listener.handleEvent(new Event("change"));
      }
    },
  };
}

function animationStub(): AnimationStub {
  let resolve: (value: Animation) => void;
  const finished = new Promise<Animation>((done) => {
    resolve = done;
  });
  const animation = {
    id: "",
    currentTime: 0,
    effect: { composite: "add" },
    playState: "running",
    cancel: vi.fn(),
    addEventListener: vi.fn(
      (_event: string, _listener: EventListener) => undefined,
    ),
    removeEventListener: vi.fn(),
    onfinish: null as ((event: AnimationPlaybackEvent) => void) | null,
    finished,
    complete() {
      animation.playState = "finished";
      animation.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
      resolve(animation as unknown as Animation);
      for (const [event, listener] of animation.addEventListener.mock.calls) {
        if (event === "finish")
          (listener as EventListener)(new Event("finish"));
      }
    },
  };
  return animation as unknown as AnimationStub;
}

function framesOf(call: unknown[]) {
  return call[0] as Keyframe[];
}

function shadowParts(frame: Keyframe) {
  const value = String(frame.boxShadow);
  const color = value.match(/rgba?\([^)]+\)|transparent/)?.[0];
  const geometry = value
    .replace(/rgba?\([^)]+\)|transparent|inset/g, "")
    .match(/-?\d*\.?\d+/g)
    ?.map(Number);
  return { color, spread: geometry?.[3], inset: value.includes("inset") };
}

describe("installFocusRingMotion", () => {
  let cleanup: (() => void) | undefined;
  let target: HTMLButtonElement;
  let keyboardFocus: boolean;
  let outlineColor: string;
  let outlineWidth: string;
  let outlineOffset: string;
  let computedShadow: string | undefined;
  let reduced: ReturnType<typeof mediaQuery>;
  let forced: ReturnType<typeof mediaQuery>;
  let animations: AnimationStub[];
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reduced = mediaQuery("(prefers-reduced-motion: reduce)");
    forced = mediaQuery("(forced-colors: active)");
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        (query.includes("forced-colors")
          ? forced.query
          : reduced.query) as unknown as MediaQueryList,
    );
    target = document.createElement("button");
    target.style.boxShadow = "0 2px 4px black";
    target.style.transition = "transform 200ms ease";
    document.body.append(target);
    keyboardFocus = true;
    outlineColor = focusColor;
    outlineWidth = "2px";
    outlineOffset = "-2px";
    computedShadow = undefined;
    const nativeMatches = target.matches.bind(target);
    vi.spyOn(target, "matches").mockImplementation((selector) =>
      selector.includes(":focus-visible")
        ? keyboardFocus
        : nativeMatches(selector),
    );
    const nativeComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const original = nativeComputedStyle(element);
      if (element !== target) return original;
      return new Proxy(original, {
        get(style, property) {
          if (property === "outlineColor") return outlineColor;
          if (property === "outlineWidth") return outlineWidth;
          if (property === "outlineStyle") return "solid";
          if (property === "outlineOffset") return outlineOffset;
          if (property === "boxShadow" && computedShadow !== undefined)
            return computedShadow;
          const value = Reflect.get(style, property);
          return typeof value === "function" ? value.bind(style) : value;
        },
      });
    });
    animations = [];
    animate = vi.fn(() => {
      const animation = animationStub();
      animations.push(animation);
      return animation;
    });
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
    delete document.documentElement.dataset.crateMotion;
    vi.restoreAllMocks();
    if (originalAnimate)
      Object.defineProperty(Element.prototype, "animate", originalAnimate);
    else delete (Element.prototype as Partial<Element>).animate;
  });

  function focus() {
    target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  }
  function blur() {
    keyboardFocus = false;
    target.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  it("adds only a continuous shadow with Listen timing and restores the static outline afterwards", () => {
    cleanup = installFocusRingMotion();
    const inlineBefore = target.getAttribute("style");
    focus();
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0];
    expect(shadowParts((frames as Keyframe[])[0])).toEqual({
      color: "transparent",
      spread: 0,
      inset: true,
    });
    expect(shadowParts((frames as Keyframe[])[1])).toEqual({
      color: focusColor,
      spread: 2,
      inset: true,
    });
    expect(options).toEqual(
      expect.objectContaining({
        duration: 500,
        easing: focusEasing,
        composite: "add",
      }),
    );
    for (const frame of frames as Keyframe[])
      expect(Object.keys(frame)).toEqual(["boxShadow"]);
    expect(animations[0].id).toBe("crate-focus-ring");
    expect(target).toHaveAttribute("data-crate-focus-motion");
    expect(target.getAttribute("style")).toBe(inlineBefore);
    animations[0].complete();
    expect(target).not.toHaveAttribute("data-crate-focus-motion");
    expect(target.getAttribute("style")).toBe(inlineBefore);
  });

  it("keeps the CSS outline on SVG controls without trying to add a shadow", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("tabindex", "0");
    svg.style.outlineColor = focusColor;
    svg.style.outlineWidth = "2px";
    svg.style.outlineStyle = "solid";
    document.body.append(svg);
    vi.spyOn(svg, "matches").mockReturnValue(true);
    cleanup = installFocusRingMotion();
    svg.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(animate).not.toHaveBeenCalled();
    expect(svg).not.toHaveAttribute("data-crate-focus-motion");
    expect(svg.style.outlineColor).toBe(focusColor);
    expect(svg.style.outlineWidth).toBe("2px");
  });

  it("does not animate pointer focus on an ordinary button", () => {
    cleanup = installFocusRingMotion();
    keyboardFocus = false;
    focus();
    expect(animate).not.toHaveBeenCalled();
  });

  it("shrinks the inset shadow while fading out after entry has finished", async () => {
    cleanup = installFocusRingMotion();
    focus();
    animations[0].complete();
    await Promise.resolve();
    blur();
    expect(animate).toHaveBeenCalledTimes(2);
    const frames = framesOf(animate.mock.calls[1]);
    expect(shadowParts(frames[0])).toEqual({
      color: focusColor,
      spread: 2,
      inset: true,
    });
    expect(shadowParts(frames[1])).toEqual({
      color: "transparent",
      spread: 0,
      inset: true,
    });
    expect(target).toHaveAttribute("data-crate-focus-motion");
    animations[1].complete();
    expect(target).not.toHaveAttribute("data-crate-focus-motion");
  });

  it("retargets rapid refocus from the rendered subpixel shadow instead of copying base elevation", () => {
    cleanup = installFocusRingMotion();
    focus();
    computedShadow = `rgb(0, 0, 0) 0px 2px 4px 0px, ${partialColor} 0px 0px 0px 0.742px inset`;
    blur();
    keyboardFocus = true;
    focus();
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(animations[1].cancel).toHaveBeenCalled();
    for (const call of [animate.mock.calls[1], animate.mock.calls[2]]) {
      expect(shadowParts(framesOf(call)[0])).toEqual({
        color: partialColor,
        spread: 0.742,
        inset: true,
      });
    }
  });

  for (const preference of ["system", "crate", "forced colors"] as const) {
    it(`keeps the static CSS focus under ${preference}`, () => {
      if (preference === "system") reduced.set(true);
      if (preference === "crate")
        document.documentElement.dataset.crateMotion = "reduced";
      if (preference === "forced colors") forced.set(true);
      cleanup = installFocusRingMotion();
      focus();
      expect(animate).not.toHaveBeenCalled();
      expect(target).not.toHaveAttribute("data-crate-focus-motion");
    });
  }

  it("cancels an in-flight animation as soon as the OS reduces motion", () => {
    cleanup = installFocusRingMotion();
    focus();
    reduced.set(true);
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(target).not.toHaveAttribute("data-crate-focus-motion");
    focus();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight animation when Crate reduces motion", async () => {
    cleanup = installFocusRingMotion();
    focus();
    document.documentElement.dataset.crateMotion = "reduced";
    await Promise.resolve();
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(target).not.toHaveAttribute("data-crate-focus-motion");
    blur();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("falls back to CSS when an element cannot use Web Animations", () => {
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: undefined,
    });
    cleanup = installFocusRingMotion();
    expect(focus).not.toThrow();
    expect(animate).not.toHaveBeenCalled();
  });

  it("keeps static CSS focus when additive shadow composition is unavailable", () => {
    animate.mockImplementation(() => {
      const animation = animationStub();
      (animation.effect as KeyframeEffect).composite = "replace";
      animations.push(animation);
      return animation;
    });
    const inlineBefore = target.getAttribute("style");
    cleanup = installFocusRingMotion();
    focus();
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(target).not.toHaveAttribute("data-crate-focus-motion");
    expect(target.getAttribute("style")).toBe(inlineBefore);
  });

  it("keeps replacement controls working after a finished focused control is removed", () => {
    cleanup = installFocusRingMotion();
    focus();
    animations[0].complete();
    target.remove();

    const replacement = document.createElement("button");
    replacement.style.outlineColor = focusColor;
    replacement.style.outlineStyle = "solid";
    replacement.style.outlineWidth = "2px";
    replacement.style.outlineOffset = "0px";
    document.body.append(replacement);
    vi.spyOn(replacement, "matches").mockReturnValue(true);
    replacement.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(animate).toHaveBeenCalledTimes(2);

    cleanup();
    cleanup = undefined;
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(animations[1].cancel).toHaveBeenCalledTimes(1);

    document.body.append(target);
    focus();
    replacement.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("cancels an animation on a removed control and ignores late completion after disposal", () => {
    cleanup = installFocusRingMotion();
    focus();
    target.remove();
    cleanup();
    cleanup = undefined;
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(target).not.toHaveAttribute("data-crate-focus-motion");

    animations[0].complete();
    document.body.append(target);
    focus();
    blur();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
  });

  it("releases listeners and active animations on cleanup", () => {
    cleanup = installFocusRingMotion();
    focus();
    cleanup();
    cleanup = undefined;
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(target).not.toHaveAttribute("data-crate-focus-motion");
    blur();
    focus();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(reduced.query.removeEventListener).toHaveBeenCalled();
    expect(forced.query.removeEventListener).toHaveBeenCalled();
  });
});
