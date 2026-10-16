import { useCallback, type ReactNode } from "react";

interface ReadoutProps {
  children: ReactNode;
  announcement?: string;
  minWidthCh?: number;
}

export function Readout({
  children,
  announcement,
  minWidthCh = 12,
}: ReadoutProps) {
  const reserve =
    Number.isFinite(minWidthCh) && minWidthCh >= 0 ? minWidthCh : 12;
  const setWidth = useCallback(
    (node: HTMLSpanElement | null) => {
      node?.style.setProperty("--readout-min-width", `${reserve}ch`);
    },
    [reserve],
  );

  return (
    <>
      <span
        ref={setWidth}
        aria-hidden="true"
        className="crate-readout font-mono text-eyebrow tracking-wide text-text-muted"
      >
        {children}
      </span>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </>
  );
}
