import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent, CardHeader } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { DevLogEntry } from "../../lib/dev-logs";

export function TauriDevLogPanelView({
  logs,
  open,
  onOpenChange,
  onClear,
}: {
  logs: readonly DevLogEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
}) {
  const { t, i18n } = useTranslation();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const hide = () => {
    onOpenChange(false);
    trigger.current?.focus();
  };
  return (
    <div
      data-slot="tauri-dev-logs"
      className="grid w-full min-w-0 gap-2 text-text-primary"
    >
      {open ? (
        <Card
          as="section"
          id={panelId}
          aria-label={t("native.logs.title")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              hide();
            }
          }}
        >
          <CardHeader>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="grid min-w-0 gap-2">
                <MonoLabel as="h2" tone="accent">
                  {t("native.logs.title")}
                </MonoLabel>
                <MonoLabel>
                  {t("native.logs.events", { count: logs.length })}
                </MonoLabel>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClear}
                  disabled={!logs.length}
                >
                  {t("native.logs.clear")}
                </Button>
                <Button variant="ghost" size="sm" onClick={hide}>
                  {t("native.logs.hide")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="max-h-[42vh] overflow-auto"
              tabIndex={logs.length ? 0 : undefined}
              role={logs.length ? "region" : undefined}
              aria-label={
                logs.length
                  ? t("native.logs.events", { count: logs.length })
                  : undefined
              }
            >
              {!logs.length ? (
                <p className="m-0 py-4 text-sm text-text-muted">
                  {t("native.logs.empty")}
                </p>
              ) : (
                <ol className="m-0 grid list-none gap-3 p-0">
                  {logs
                    .slice()
                    .reverse()
                    .map((entry) => (
                      <li
                        key={entry.id}
                        className="min-w-0 border-b border-border-quiet pb-3 last:border-0 last:pb-0"
                      >
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
                          <MonoLabel as="span">
                            {new Date(entry.timestamp).toLocaleTimeString(
                              i18n.language,
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              },
                            )}
                          </MonoLabel>
                          <MonoLabel as="span" tone="accent">
                            {entry.scope}
                          </MonoLabel>
                          <span
                            className={
                              entry.level === "error"
                                ? "font-mono text-xs text-state-danger-text"
                                : entry.level === "warn"
                                  ? "font-mono text-xs text-state-warning-text"
                                  : "font-mono text-xs text-text-primary"
                            }
                          >
                            {entry.message}
                          </span>
                        </div>
                        {entry.detail ? (
                          <pre
                            tabIndex={0}
                            role="region"
                            aria-label={entry.message}
                            className="mb-0 mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-secondary"
                          >
                            {entry.detail}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div>
        <Button
          ref={trigger}
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => onOpenChange(!open)}
        >
          {t("native.logs.trigger", { count: logs.length })}
        </Button>
      </div>
    </div>
  );
}
