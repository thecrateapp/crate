import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { CopyButton } from "./CopyButton";

export function TechnicalDetails({
  items,
  title = "Technical details",
}: {
  items: { label: string; value: string | number | null | undefined }[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-4" />
        )}
        {title}
      </button>
      {open ? (
        <dl id={contentId} className="mt-2 space-y-2">
          {items.map((item) => {
            const isEmpty =
              item.value === null ||
              item.value === undefined ||
              item.value === "";
            const text = isEmpty ? null : `${item.value}`;
            return (
              <div
                key={item.label}
                className="flex flex-wrap items-center gap-2"
              >
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className={cn("flex min-w-0 items-center gap-2")}>
                  {text ? (
                    <>
                      <code className="break-all">{text}</code>
                      <CopyButton value={text} label={item.label} />
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}
