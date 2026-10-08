import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function StatsReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (revealed) return;
    const node = nodeRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <div
      ref={nodeRef}
      data-revealed={revealed ? "true" : undefined}
      className={cn("stats-reveal", className)}
    >
      {children}
    </div>
  );
}
