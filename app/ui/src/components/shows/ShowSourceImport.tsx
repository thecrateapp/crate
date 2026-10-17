import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { api } from "@/lib/api";
import { waitForShowJob } from "./show-import-jobs";
import type { ShowDraft, ShowJob } from "./show-import-types";

type Method = "parse" | "ocr" | "vision" | "text_llm" | "ocr_text_llm";
interface Availability {
  configured: boolean;
  configuration_fingerprint?: string;
  model?: string;
  connectivity: string;
  vision: string;
  ocr: { available: boolean; reason?: string };
}
interface Recent {
  id: string;
  job_id: string;
  status: string;
}
export function ShowSourceImport({
  open,
  onDraft,
  disabled = false,
  onBusyChange,
}: {
  open: boolean;
  onDraft: (draft: ShowDraft) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [method, setMethod] = useState<Method>("ocr");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<{ id: string; file: File }[]>([]);
  const [storedImages, setStoredImages] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{
    payload: Record<string, unknown>;
    jobId?: string;
  } | null>(null);
  const key = useRef<string | null>(null);
  const notifyClosed = useEffectEvent(() => onBusyChange?.(false));
  useEffect(() => {
    if (!open) {
      controller.current?.abort();
      setBusy(false);
      notifyClosed();
      if (pending.current) setUncertain(true);
      return;
    }
    const abort = new AbortController();
    void api<Availability>("/api/show-imports/availability", "GET", undefined, {
      signal: abort.signal,
    })
      .then(setAvailability)
      .catch(() => {});
    void api<{ items: Recent[] }>(
      "/api/show-imports/drafts",
      "GET",
      undefined,
      { signal: abort.signal },
    )
      .then((value) => setRecent(value.items))
      .catch(() => {});
    return () => abort.abort();
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);
  function changed() {
    pending.current = null;
    key.current = crypto.randomUUID();
    setError("");
    setStatus("");
    setUncertain(false);
  }
  function addFiles(incoming: File[]) {
    if (
      files.length + storedImages.length + incoming.length > 3 ||
      incoming.some(
        (file) =>
          file.size > 8388608 ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type),
      )
    ) {
      setError(
        "Use at most 3 PNG, JPEG or WebP images, each up to 8 MiB and 20 megapixels.",
      );
      return;
    }
    const added = incoming.map((file) => ({ id: crypto.randomUUID(), file }));
    setFiles((current) => [...current, ...added]);
    changed();
  }
  async function receive(job: ShowJob) {
    const draft = job.result?.draft;
    if (draft?.readiness) {
      setAvailability(draft.readiness);
      setStatus("Worker readiness checked; no billable extraction was made.");
      return;
    }
    if (draft?.candidates) {
      const complete = { ...draft, draft_id: job.result?.execution?.draft_id };
      setText(draft.raw_text ?? "");
      onDraft(complete);
      setStatus(
        `${draft.candidates.length} candidates · coverage ${draft.coverage}. Compare every date with the source; only your selection will be saved.`,
      );
    }
    if (job.status !== "completed")
      setError(
        job.result?.execution?.error ??
          "Extraction did not finish. Keep the draft and retry another method or enter fields manually.",
      );
  }
  async function run(probe = false) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setUncertain(false);
    setStatus("Extracting in the worker; nothing is published…");
    try {
      if (!pending.current) {
        key.current ??= crypto.randomUUID();
        const imageMode = ["ocr", "ocr_text_llm", "vision"].includes(method);
        const uploads: string[] = !probe && imageMode ? [...storedImages] : [];
        if (!probe && imageMode) {
          // At most three images. Settle every upload before unlocking a failed
          // attempt; preserve source order even when responses arrive out of order.
          const images = await Promise.allSettled(
            files.map(({ file }) => {
              const form = new FormData();
              form.append("file", file);
              return api<{ upload_id: string }>(
                "/api/show-imports/uploads",
                "POST",
                form,
                { signal: abort.signal },
              );
            }),
          );
          abort.signal.throwIfAborted();
          uploads.push(
            ...images.map((image) => {
              if (image.status === "rejected") throw image.reason;
              return image.value.upload_id;
            }),
          );
        }
        pending.current = {
          payload: {
            mode: probe ? "probe" : method,
            upload_ids: uploads,
            raw_text: probe ? "" : text,
            source_url: probe ? null : url || null,
            expected_model:
              !probe && ["vision", "text_llm", "ocr_text_llm"].includes(method)
                ? availability?.model
                : null,
            expected_configuration:
              !probe && ["vision", "text_llm", "ocr_text_llm"].includes(method)
                ? availability?.configuration_fingerprint
                : null,
            idempotency_key: key.current,
          },
        };
      }
      const request = pending.current;
      if (!request.jobId)
        request.jobId = (
          await api<{ job_id: string }>(
            "/api/show-imports/extractions",
            "POST",
            request.payload,
            { signal: abort.signal },
          )
        ).job_id;
      setStatus(
        `Extraction job ${request.jobId} running; nothing is published…`,
      );
      const finished = await waitForShowJob(request.jobId, abort.signal);
      if (abort.signal.aborted) return;
      await receive(finished);
      pending.current = null;
      key.current = crypto.randomUUID();
    } catch (failure) {
      if (abort.signal.aborted) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Extraction could not be completed",
      );
      const status = (failure as { status?: number })?.status;
      if (status && status < 500) {
        pending.current = null;
        key.current = crypto.randomUUID();
        setUncertain(false);
      } else if (pending.current) setUncertain(true);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function resume(row: Recent) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const saved = await api<{
        result: ShowDraft | null;
        input?: {
          mode: Method | "probe";
          raw_text: string;
          source_url?: string;
          upload_ids: string[];
        };
      }>(`/api/show-imports/drafts/${row.id}`);
      if (saved.input) {
        setStoredImages(saved.input.upload_ids);
        setFiles([]);
        setText(saved.input.raw_text);
        setUrl(saved.input.source_url ?? "");
        setMethod(saved.input.mode === "probe" ? "parse" : saved.input.mode);
      }
      if (saved.result?.candidates) {
        onDraft({ ...saved.result, draft_id: row.id });
        setText(saved.result.raw_text);
        setStatus(
          "Private draft recovered. Saved rows remain linked; review pending dates.",
        );
      } else {
        pending.current = { payload: {}, jobId: row.job_id };
        setStatus(`Resuming extraction ${row.job_id}…`);
        const job = await waitForShowJob(row.job_id, abort.signal);
        if (!abort.signal.aborted) {
          await receive(job);
          pending.current = null;
          key.current = crypto.randomUUID();
        }
      }
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not recover draft",
        );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function cancel() {
    const jobId = pending.current?.jobId;
    if (!jobId) return;
    try {
      const state = await api<{ cancellation_acknowledged?: boolean }>(
        `/api/show-imports/jobs/${jobId}/cancel`,
        "POST",
      );
      setStatus(
        state.cancellation_acknowledged
          ? "Worker stop acknowledged."
          : "Stop requested; waiting for worker acknowledgement.",
      );
    } catch {
      setError("Could not request stop; check the same job again.");
    }
  }
  return (
    <section
      className="space-y-3 rounded-md border border-border p-3"
      aria-label="Import show source"
    >
      <h3 className="font-medium">Import flyer, screenshot or event link</h3>
      <p className="text-xs text-muted-foreground">
        Local OCR is free and sends no image to an LLM. Model modes send the
        selected source to your configured provider in one explicit call. Images
        expire after 24 hours.
      </p>
      {availability ? (
        <p className="text-xs">
          OCR worker:{" "}
          {availability.ocr.available
            ? "ready"
            : availability.ocr.reason || "not checked"}{" "}
          · LLM:{" "}
          {availability.configured
            ? availability.model || "configured"
            : "not configured"}{" "}
          · connectivity: {availability.connectivity} · vision:{" "}
          {availability.vision}
        </p>
      ) : null}
      <fieldset disabled={disabled || busy || uncertain} className="space-y-3">
        <label className="block text-sm">
          Extraction method
          <select
            className="ml-2 rounded border border-border bg-card p-1"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as Method);
              changed();
            }}
          >
            <option value="ocr">Local OCR (free, no LLM)</option>
            <option value="parse">Text / URL rules (free, no LLM)</option>
            <option
              value="vision"
              disabled={
                !availability?.configured ||
                availability.vision === "unsupported"
              }
            >
              Configured model vision
            </option>
            <option value="text_llm" disabled={!availability?.configured}>
              Configured model from text / URL
            </option>
            <option value="ocr_text_llm" disabled={!availability?.configured}>
              Local OCR then configured text model
            </option>
          </select>
        </label>
        <label className="block text-sm">
          Images (up to 3)
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
        <div
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files).filter(
              (file) => file.type.startsWith("image/"),
            );
            if (pasted.length) {
              event.preventDefault();
              addFiles(pasted);
            }
          }}
        >
          <label className="block text-sm">
            Source text
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-card p-2"
              value={text}
              maxLength={60000}
              onChange={(event) => {
                setText(event.target.value);
                changed();
              }}
              placeholder="Paste source text or an image here. Full ISO dates can be proposed without an LLM."
            />
          </label>
        </div>
        {storedImages.length ? (
          <p className="text-sm">
            {storedImages.length} private image(s) recovered{" "}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setStoredImages([]);
                changed();
              }}
            >
              Clear recovered images
            </Button>
          </p>
        ) : null}
        {files.map(({ id, file }, index) => (
          <div key={id} className="text-sm">
            {file.name}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFiles((current) =>
                  current.filter((image) => image.id !== id),
                );
                changed();
              }}
            >
              Remove image {index + 1}
            </Button>
          </div>
        ))}
        <label className="block text-sm">
          Source URL
          <Input
            type="url"
            value={url}
            maxLength={2048}
            onChange={(event) => {
              setUrl(event.target.value);
              changed();
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          A link is fetched in the worker with public-address and redirect
          checks. If Instagram or another site requires login, upload a
          screenshot or paste its text.
        </p>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm">
          {status}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={
            disabled ||
            busy ||
            uncertain ||
            (!text.trim() && !url && !files.length && !storedImages.length)
          }
          onClick={() => void run()}
        >
          Extract candidates
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || uncertain}
          onClick={() => void run(true)}
        >
          Check worker readiness
        </Button>
        {uncertain ? (
          <Button type="button" onClick={() => void run()}>
            Resume same extraction
          </Button>
        ) : null}
        {busy && pending.current?.jobId ? (
          <Button type="button" variant="outline" onClick={() => void cancel()}>
            Request extraction stop
          </Button>
        ) : null}
      </div>
      {recent.length ? (
        <details>
          <summary>Recover a private draft</summary>
          {recent.map((row) => (
            <Button
              key={row.id}
              type="button"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => void resume(row)}
            >
              Resume {row.job_id} · {row.status}
            </Button>
          ))}
        </details>
      ) : null}
    </section>
  );
}
