import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type Ref,
} from "react";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

interface MeterProps {
  value: number | null;
  max: number;
  limit?: number;
  over?: boolean;
  label: ReactNode;
  valueText: string;
  thickness?: 1 | 2 | 3 | 4;
  valueRef?: Ref<HTMLElement>;
}

export function Meter({
  value,
  max,
  limit,
  over = false,
  label,
  valueText,
  thickness = 2,
  valueRef,
}: MeterProps) {
  const labelId = useId();
  const readingId = useId();
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const limitRef = useRef<HTMLSpanElement | null>(null);
  const hasValue = value !== null && Number.isFinite(value);
  const hasRange = hasValue && Number.isFinite(max) && max > 0;
  const boundedValue = hasRange ? Math.max(0, Math.min(value, max)) : 0;
  const ratio = hasRange ? boundedValue / max : 0;
  const warning = hasRange && over;
  const reading = hasValue ? valueText : "n/a";
  const attachFill = useCallback(
    (node: HTMLSpanElement | null) => {
      fillRef.current = node;
      if (typeof valueRef === "function") return valueRef(node);
      if (valueRef) valueRef.current = node;
    },
    [valueRef],
  );

  useEffect(() => {
    fillRef.current?.style.setProperty("--v", String(ratio));
    if (limitRef.current && limit != null) {
      limitRef.current.style.left = `${Math.max(0, Math.min(limit / max, 1)) * 100}%`;
    }
  }, [ratio, hasRange, limit, max]);

  return (
    <div
      className="crate-meter"
      role={hasRange ? "meter" : "group"}
      aria-labelledby={labelId}
      aria-describedby={hasRange ? undefined : readingId}
      aria-valuemin={hasRange ? 0 : undefined}
      aria-valuemax={hasRange ? max : undefined}
      aria-valuenow={hasRange ? boundedValue : undefined}
      aria-valuetext={hasRange ? valueText : undefined}
    >
      <div className="crate-meter-layout">
        <MonoLabel as="span" id={labelId} className="min-w-0">
          {label}
          {warning ? <span className="block">over · max {max}</span> : null}
        </MonoLabel>
        <span
          className="crate-meter-track relative min-w-0 bg-border-quiet"
          data-thickness={thickness}
        >
          {hasRange ? (
            <span
              ref={attachFill}
              aria-hidden="true"
              className={`crate-meter-fill absolute inset-0 origin-left ${warning ? "bg-state-warning" : "bg-accent-action-hi"}`}
            />
          ) : null}
          {hasRange && limit != null && Number.isFinite(limit) ? (
            <span
              ref={limitRef}
              aria-hidden="true"
              className="crate-meter-limit absolute -top-1 -bottom-1 w-px bg-text-primary"
            />
          ) : null}
        </span>
        <span
          id={readingId}
          className={`crate-meter-value font-mono text-label tabular-nums text-right ${warning ? "text-state-warning" : "text-text-primary"}`}
        >
          {reading}
        </span>
      </div>
    </div>
  );
}
