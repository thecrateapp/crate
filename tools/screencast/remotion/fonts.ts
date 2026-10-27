import { useEffect, useState } from "react";
import {
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
} from "remotion";

export const MONO = "'JetBrains Mono', ui-monospace, monospace";
export const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";

export function useFilmFonts() {
  const [handle] = useState(() => delayRender("Loading film fonts"));
  useEffect(() => {
    Promise.all([
      new FontFace(
        "JetBrains Mono",
        `url(${staticFile("fonts/jetbrains-mono-latin-500-normal.woff2")})`,
        { weight: "500" },
      ).load(),
      new FontFace(
        "Bricolage Grotesque",
        `url(${staticFile(
          "fonts/bricolage-grotesque-latin-opsz-normal.woff2",
        )})`,
        { weight: "200 800" },
      ).load(),
    ])
      .then((fonts) => {
        fonts.forEach((font) => document.fonts.add(font));
        continueRender(handle);
      })
      .catch((error) => cancelRender(error));
  }, [handle]);
}
