interface ProgressHairlineProps {
  value?: number;
  label: string;
  valueText?: string;
  thickness?: 1 | 2;
}

export function ProgressHairline({
  value,
  label,
  valueText,
  thickness = 2,
}: ProgressHairlineProps) {
  const determinate = value !== undefined && Number.isFinite(value);
  const ratio = determinate ? Math.max(0, Math.min(value, 1)) : 0;
  const barRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const motionAllowed = useMotionAllowed();
  const setFill = useCallback(
    (node: HTMLSpanElement | null) => {
      node?.style.setProperty("--p", String(ratio));
    },
    [ratio],
  );

  useEffect(() => {
    setVisible(false);
    if (
      determinate ||
      !barRef.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry?.isIntersecting ?? false);
    });
    observer.observe(barRef.current);
    return () => observer.disconnect();
  }, [determinate]);

  return (
    <span
      ref={barRef}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? ratio * 100 : undefined}
      aria-valuetext={valueText}
      className="crate-progress-hairline"
      data-thickness={thickness}
      data-indeterminate={!determinate || undefined}
      data-animated={(!determinate && visible && motionAllowed) || undefined}
    >
      <span
        ref={setFill}
        aria-hidden="true"
        className="crate-progress-hairline-fill"
      />
    </span>
  );
}
import { useCallback, useEffect, useRef, useState } from "react";

import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
