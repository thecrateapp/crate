import { renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { useAlbumHeroMeasurement } from "./use-album-page-effects";

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("useAlbumHeroMeasurement", () => {
  it("settles when the measured gap does not react to the applied offset", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      const [offset, setOffset] = useState(0);
      const info = useRef<HTMLDivElement | null>(document.createElement("div"));
      const actions = useRef<HTMLDivElement | null>(
        document.createElement("div"),
      );
      // The layout ignores the offset: the gap stays 50px whatever is applied.
      info.current!.getBoundingClientRect = () => rect(0, 100);
      actions.current!.getBoundingClientRect = () => rect(150, 200);
      useAlbumHeroMeasurement({
        albumHeroInfoRef: info,
        albumPrimaryActionsRef: actions,
        isDesktop: false,
        mobileHeroInfoOffset: offset,
        setMobileHeroInfoOffset: setOffset,
      });
      return offset;
    });

    expect(renders).toBeLessThan(10);
    expect(result.current).toBe(30);
  });
});
