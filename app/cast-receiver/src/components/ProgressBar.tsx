import { useEffect, useRef } from "react";

import type { ReceiverStore } from "../receiver-store";

interface ProgressBarProps {
  progress: ReceiverStore["progress"];
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const value = progress.getSnapshot();
      const ratio = value.duration > 0 ? value.currentTime / value.duration : 0;
      const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${percent / 100})`;
      }
      meterRef.current?.setAttribute("aria-valuenow", String(percent));
      if (elapsedRef.current) {
        elapsedRef.current.textContent = formatTime(value.currentTime);
      }
      if (durationRef.current) {
        durationRef.current.textContent = `−${formatTime(
          Math.max(0, value.duration - value.currentTime),
        )}`;
      }
    };
    update();
    return progress.subscribe(update);
  }, [progress]);

  return (
    <div className="progress" aria-label="Playback progress">
      <div className="progress-time">
        <span ref={elapsedRef}>0:00</span>
        <span ref={durationRef}>−0:00</span>
      </div>
      <div
        aria-label="Playback progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={0}
        className="progress-track"
        ref={meterRef}
        role="progressbar"
      >
        <div className="progress-fill" ref={fillRef} />
      </div>
    </div>
  );
}
