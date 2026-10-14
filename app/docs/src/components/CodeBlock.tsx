import { useEffect, useMemo, useRef, useState } from "react";

import { highlight } from "@/lib/highlight";

type CopyState = "idle" | "copied" | "failed";

const copyLabels: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);
  const tokens = useMemo(() => highlight(code, language), [code, language]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  }

  return (
    <figure className="code-block">
      <figcaption className="code-bar">
        <span className="code-lang">{language || "text"}</span>
        <button
          type="button"
          className="code-copy"
          data-state={state}
          onClick={() => void copy()}
          aria-label={state === "idle" ? "Copy code" : copyLabels[state]}
        >
          <span aria-hidden="true">{copyLabels[state]}</span>
        </button>
        <span className="sr-only" aria-live="polite">
          {state === "idle" ? "" : copyLabels[state]}
        </span>
      </figcaption>
      <pre tabIndex={0}>
        <code>
          {tokens.map((token, index) =>
            token.kind === "plain" ? (
              token.text
            ) : (
              <span key={index} className={`tok-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
