import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ImagePlus, X } from "lucide-react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { ExtractionMethodCards } from "./ExtractionMethodCards";
import { countLabel, draftRowView } from "./show-import-presentation";
import type { ShowSourceState } from "./use-show-source";

function imageFiles(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

function SourceImages({
  source,
  locked,
}: {
  source: ShowSourceState;
  locked: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  return (
    <div
      role="group"
      aria-label="Source images"
      aria-describedby={hintId}
      data-dragging={dragging ? "" : undefined}
      className="space-y-3 rounded-md border border-dashed border-border p-4 transition-colors data-[dragging]:border-accent-action data-[dragging]:bg-accent-action/5"
      onDragOver={(event) => {
        // Always claim the drop so the browser never opens the file instead.
        event.preventDefault();
        if (!locked) setDragging(true);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && event.currentTarget.contains(next)))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!locked) source.addImages(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ImagePlus
          aria-hidden="true"
          className="size-5 text-muted-foreground"
        />
        <span>Drop a flyer or screenshot here, paste it, or</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={() => fileInput.current?.click()}
        >
          Choose images
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Images"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={locked}
        onChange={(event) => {
          source.addImages(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        PNG, JPEG or WebP · up to 3 images · 8 MB each. Images stay private for
        24 hours.
      </p>
      {source.images.length ? (
        <ul className="flex flex-wrap gap-2">
          {source.images.map(({ id, file }, index) => (
            <li
              key={id}
              className="flex max-w-full items-center gap-1 rounded-md border border-border py-0.5 pr-0.5 pl-2 text-sm"
            >
              <span className="truncate">{file.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove image ${index + 1}`}
                disabled={locked}
                onClick={() => source.removeImage(id)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {source.storedImages.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {countLabel(source.storedImages.length, "image")} from the reopened
            import
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Clear reopened images"
            disabled={locked}
            onClick={source.clearStoredImages}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RecentImports({
  source,
  locked,
}: {
  source: ShowSourceState;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown aria-hidden="true" />
        ) : (
          <ChevronRight aria-hidden="true" />
        )}
        Recent imports
      </Button>
      {open ? (
        <ul id={listId} className="space-y-2">
          {source.recent.map((row) => {
            const view = draftRowView(row);
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-2"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{view.title}</p>
                  <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    <span>{view.detail}</span>
                    <span aria-hidden="true">·</span>
                    <RelativeTime value={row.created_at} />
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Open ${view.title} import`}
                  disabled={locked}
                  onClick={() => source.recover(row)}
                >
                  Open
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function ShowSourcePanel({
  source,
  disabled = false,
}: {
  source: ShowSourceState;
  disabled?: boolean;
}) {
  const textId = useId();
  const urlId = useId();
  const urlHintId = useId();
  const locked = disabled || source.busy || source.uncertain;
  return (
    <section
      aria-label="Import source"
      className="space-y-4"
      onPaste={(event) => {
        const pasted = imageFiles(event.clipboardData?.files);
        if (!pasted.length) return;
        event.preventDefault();
        if (!locked) source.addImages(pasted);
      }}
    >
      <SourceImages source={source} locked={locked} />
      <div className="space-y-1.5">
        <label htmlFor={textId} className="text-sm font-medium">
          Pasted text
        </label>
        <Textarea
          id={textId}
          value={source.text}
          maxLength={60000}
          disabled={locked}
          placeholder="Paste the event text or a tour list. You can also paste an image here."
          onChange={(event) => source.setText(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={urlId} className="text-sm font-medium">
          Event link
        </label>
        <Input
          id={urlId}
          type="url"
          value={source.url}
          maxLength={2048}
          disabled={locked}
          aria-describedby={urlHintId}
          onChange={(event) => source.setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (source.canExtract && !disabled) source.extract();
          }}
        />
        <p id={urlHintId} className="text-xs text-muted-foreground">
          Crate fetches public pages only. If the page needs a login, paste a
          screenshot or its text instead.
        </p>
      </div>
      {!source.availability && source.availabilityFailed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p role="alert" className="text-state-danger-text">
            Couldn&apos;t load the import methods.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={source.reloadAvailability}
          >
            Try again
          </Button>
        </div>
      ) : source.options.length ? (
        <ExtractionMethodCards
          options={source.options}
          value={source.method}
          readiness={source.readiness}
          along={{
            pastedText: Boolean(source.text.trim()),
            link: Boolean(source.url.trim()),
          }}
          disabled={locked}
          onChange={source.chooseMethod}
          onRecheck={source.recheck}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Add a flyer, text or link to choose how to read it.
        </p>
      )}
      {source.error ? (
        <p role="alert" className="text-sm text-state-danger-text">
          {source.error}
        </p>
      ) : null}
      <p role="status" className="text-sm empty:sr-only">
        {source.status}
      </p>
      {source.warnings.length ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground font-display">Notes</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {source.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!source.canExtract || disabled}
          onClick={source.extract}
        >
          Find dates
        </Button>
        {source.uncertain ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || source.busy}
            onClick={source.retry}
          >
            Retry import
          </Button>
        ) : null}
        {source.canStop ? (
          <Button type="button" variant="outline" onClick={source.stop}>
            Stop reading
          </Button>
        ) : null}
      </div>
      {source.recent.length ? (
        <RecentImports source={source} locked={disabled || source.busy} />
      ) : null}
    </section>
  );
}
