import type { ReactNode } from "react";
/** Viewport-sized art plus scrollable identity/controls: short screens never crop the transport. */
export function PlayerStage({
  artwork,
  children,
  bottomClearance = "var(--listen-safe-bottom)",
}: {
  artwork: ReactNode;
  children: ReactNode;
  bottomClearance?: string;
}) {
  return (
    <div
      data-slot="player-stage"
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      style={{ containerType: "size" }}
    >
      <div
        className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-5 pt-4"
        style={{
          paddingBottom: bottomClearance,
          paddingLeft: "max(1.5rem, var(--listen-safe-left))",
          paddingRight: "max(1.5rem, var(--listen-safe-right))",
        }}
      >
        <div
          className="relative z-10 shrink-0"
          style={{ width: "min(100%, 30vh, 45cqh, 360px)" }}
        >
          {artwork}
        </div>
        <div className="relative z-10 w-full text-center">{children}</div>
      </div>
    </div>
  );
}
