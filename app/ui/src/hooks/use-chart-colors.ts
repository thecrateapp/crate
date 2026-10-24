import { useEffect, useState } from "react";
import { readCssColorToken } from "@crate/ui/lib/read-css-color";

function readChartColors() {
  const color = (token: `--${string}`) =>
    typeof document === "undefined"
      ? `var(${token})`
      : readCssColorToken(document.documentElement, token) || `var(${token})`;
  return {
    accent: color("--accent-action-hi"),
    primary: color("--text-primary"),
    secondary: color("--text-secondary"),
    subtle: color("--text-subtle"),
    border: color("--border-quiet"),
    surface: color("--surface-app"),
    warning: color("--state-warning"),
  };
}

export function useChartColors() {
  const [colors, setColors] = useState(readChartColors);
  useEffect(() => {
    const update = () => {
      const next = readChartColors();
      setColors((current) =>
        Object.keys(next).every(
          (key) =>
            current[key as keyof typeof current] ===
            next[key as keyof typeof next],
        )
          ? current
          : next,
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-crate-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}
