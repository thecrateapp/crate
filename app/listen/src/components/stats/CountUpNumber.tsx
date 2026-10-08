import { useEffect, useRef } from "react";

import { isMotionBlocked } from "@/lib/motion-availability";

const DURATION_MS = 1200;

export function CountUpNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const previousRef = useRef(0);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const from = previousRef.current;
    previousRef.current = value;
    if (from === value || isMotionBlocked()) {
      node.textContent = format(value);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      node.textContent = format(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [format, value]);

  return (
    <span ref={nodeRef} className={className}>
      {format(value)}
    </span>
  );
}
