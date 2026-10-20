import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "@/lib/api";
import { waitForShowJob } from "./show-import-jobs";
import {
  countLabel,
  isModelMethod,
  methodOptions,
  pickMethod,
  readinessKey,
  readinessState,
  showErrorText,
  type MethodOption,
  type ReadinessState,
} from "./show-import-presentation";
import type {
  ExtractionMethod,
  ShowAvailability,
  ShowDraft,
  ShowDraftRow,
  ShowJob,
} from "./show-import-types";

export interface ShowSourceImage {
  id: string;
  file: File;
}

export interface ShowSourceState {
  availability: ShowAvailability | null;
  availabilityFailed: boolean;
  readiness: ReadinessState;
  text: string;
  url: string;
  images: ShowSourceImage[];
  storedImages: string[];
  options: MethodOption[];
  method: ExtractionMethod | null;
  recent: ShowDraftRow[];
  busy: boolean;
  uncertain: boolean;
  canExtract: boolean;
  canStop: boolean;
  status: string;
  warnings: string[];
  error: string;
  setText(value: string): void;
  setUrl(value: string): void;
  addImages(files: File[]): void;
  removeImage(id: string): void;
  clearStoredImages(): void;
  chooseMethod(method: ExtractionMethod): void;
  extract(): void;
  retry(): void;
  stop(): void;
  recheck(): void;
  recover(row: ShowDraftRow): void;
  reloadAvailability(): void;
  reset(): void;
}

interface PendingExtraction {
  payload: Record<string, unknown>;
  jobId?: string;
}

interface SavedDraft {
  result: ShowDraft | null;
  input?: {
    mode: ExtractionMethod | "probe";
    raw_text?: string | null;
    source_url?: string | null;
    upload_ids?: string[];
  };
}

const IMAGE_METHODS = new Set<ExtractionMethod>([
  "ocr",
  "ocr_text_llm",
  "vision",
]);
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MODEL_ERROR_CODES = new Set(["CONFIGURATION_CHANGED", "LLM_UNAVAILABLE"]);

const IMAGE_LIMIT_TEXT =
  "Use up to 3 PNG, JPEG or WebP images, each up to 8 MB and 20 megapixels.";
const READING_TEXT = "Reading the source. Nothing is published.";
const FOUND_TEXT =
  "Compare each one with the source; only the shows you select are saved. The source may list shows that were not found.";
const TRUNCATED_TEXT =
  "Only the first 200 shows or 60,000 characters were read.";
const NONE_FOUND_TEXT =
  "No shows found. Try another method or enter the show manually.";
const NO_NEW_TEXT =
  "No new shows. The dates Crate read are already in the draft.";
const REOPENED_TEXT =
  "Import reopened. Saved shows stay linked; the rest are ready to review.";
const UNFINISHED_TEXT =
  "The import didn't finish. Your draft is kept; try another method or enter the show manually.";
const STOPPED_TEXT = "The import was stopped.";
const STOP_REQUESTED_TEXT = "Stop requested. Waiting for the worker.";
const STOP_FAILED_TEXT = "Couldn't stop the import. Try again.";
const EXTRACT_FAILED_TEXT = "Couldn't read the source. Try again.";
const REOPEN_FAILED_TEXT = "Couldn't reopen the import. Try again.";

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** A definitive refusal: the request was read and rejected, so nothing runs. */
function isRefusal(error: unknown): boolean {
  const status = errorStatus(error);
  return status !== undefined && status < 500;
}

function uniqueWarnings(warnings?: string[]): string[] {
  return [...new Set((warnings ?? []).filter((warning) => warning.trim()))];
}

function foundText(draft: ShowDraft, added: boolean): string {
  const count = draft.candidates.length;
  if (count === 0) return NONE_FOUND_TEXT;
  const found = added
    ? `Found ${countLabel(count, "show")}. ${FOUND_TEXT}`
    : NO_NEW_TEXT;
  return draft.truncated ? `${found} ${TRUNCATED_TEXT}` : found;
}

export function useShowSource({
  active,
  onDraft,
}: {
  active: boolean;
  /** Returns false when the draft already held every show the import read. */
  onDraft: (draft: ShowDraft) => boolean | void;
}): ShowSourceState {
  const [availability, setAvailability] = useState<ShowAvailability | null>(
    null,
  );
  const [availabilityFailed, setAvailabilityFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [text, setTextValue] = useState("");
  const [url, setUrlValue] = useState("");
  const [images, setImages] = useState<ShowSourceImage[]>([]);
  const [storedImages, setStoredImages] = useState<string[]>([]);
  const [chosen, setChosen] = useState<ExtractionMethod | null>(null);
  const [recent, setRecent] = useState<ShowDraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [stoppable, setStoppable] = useState(false);
  const [status, setStatus] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");

  // The extraction (or reopened import) in flight.
  const controller = useRef<AbortController | null>(null);
  // Aborted when the panel closes; scopes the GETs and the readiness wait.
  const activation = useRef<AbortController | null>(null);
  const pending = useRef<PendingExtraction | null>(null);
  const key = useRef<string | null>(null);
  // Readiness probe bookkeeping. The probe counts against the editor's
  // extraction allowance, so an accepted job is waited on rather than
  // re-posted, a lost acceptance is retried with the same key, and the
  // automatic check posts at most once per 15-minute window and AI
  // configuration per mount.
  const probeRun = useRef<{ signal: AbortSignal } | null>(null);
  const probeJob = useRef<string | null>(null);
  const probeKey = useRef<string | null>(null);
  const autoProbeWindow = useRef<string | null>(null);

  const readiness = readinessState(availability, {
    checking,
    failed: checkFailed,
  });
  const options = methodOptions(
    availability,
    {
      images: images.length + storedImages.length,
      hasText: Boolean(text.trim() || url.trim()),
    },
    readiness,
  );
  const method = pickMethod(chosen, options);
  // A choice that stops applying is replaced, never kept in reserve, so a
  // lapsed AI choice cannot come back when the source changes again.
  if (method !== chosen) setChosen(method);

  const option = options.find((item) => item.method === method) ?? null;
  const action =
    method && isModelMethod(method) ? availability?.actions?.[method] : null;
  const hasSource = Boolean(
    text.trim() || url.trim() || images.length || storedImages.length,
  );
  const canExtract = Boolean(
    active &&
    availability &&
    !busy &&
    !uncertain &&
    method &&
    option?.disabledReason === null &&
    hasSource &&
    (!isModelMethod(method) ||
      (action?.model && action.configuration_fingerprint)),
  );

  async function loadAvailability(signal?: AbortSignal) {
    try {
      const value = await api<ShowAvailability>(
        "/api/show-imports/availability",
        "GET",
        undefined,
        { signal },
      );
      if (signal?.aborted) return null;
      setAvailability(value);
      setAvailabilityFailed(false);
      if (value.checked_at) {
        // Fresh readiness supersedes an earlier failed or lost check.
        setCheckFailed(false);
        probeKey.current = null;
      }
      return value;
    } catch {
      if (!signal?.aborted) setAvailabilityFailed(true);
      return null;
    }
  }

  async function loadRecent(signal?: AbortSignal) {
    try {
      const value = await api<{ items: ShowDraftRow[] }>(
        "/api/show-imports/drafts",
        "GET",
        undefined,
        { signal },
      );
      if (!signal?.aborted) setRecent(value.items ?? []);
    } catch {
      // Recent imports are a convenience; the panel works without them.
    }
  }

  function refreshAvailability() {
    const signal = activation.current?.signal;
    if (signal && !signal.aborted) void loadAvailability(signal);
  }

  function refreshRecent() {
    const signal = activation.current?.signal;
    if (signal && !signal.aborted) void loadRecent(signal);
  }

  /** `automaticKey` is the window key of an automatic check; null is manual. */
  async function checkReadiness(
    signal: AbortSignal,
    automaticKey: string | null,
  ) {
    if (probeRun.current && !probeRun.current.signal.aborted) return;
    const run = { signal };
    probeRun.current = run;
    setChecking(true);
    setCheckFailed(false);
    try {
      if (!probeJob.current) {
        const idempotencyKey =
          probeKey.current ??
          automaticKey ??
          `readiness-manual-${crypto.randomUUID()}`;
        probeKey.current = idempotencyKey;
        try {
          const accepted = await api<{ job_id: string }>(
            "/api/show-imports/extractions",
            "POST",
            {
              mode: "probe",
              upload_ids: [],
              raw_text: "",
              source_url: null,
              expected_model: null,
              expected_configuration: null,
              idempotency_key: idempotencyKey,
            },
            { signal },
          );
          probeJob.current = accepted.job_id;
          probeKey.current = null;
        } catch (failure) {
          // A lost or aborted acceptance keeps its key, so the next attempt
          // replays the same job instead of starting another one.
          if (signal.aborted) return;
          if (isRefusal(failure)) probeKey.current = null;
          else setCheckFailed(true);
          return;
        }
      }
      await waitForShowJob(probeJob.current, signal);
      probeJob.current = null;
      await loadAvailability(signal);
    } catch (failure) {
      if (signal.aborted) return;
      if (isRefusal(failure)) probeJob.current = null;
      setCheckFailed(true);
    } finally {
      if (probeRun.current === run) {
        probeRun.current = null;
        setChecking(false);
      }
    }
  }

  // The automatic check posts at most once per window and configuration,
  // unless an accepted job or a kept key is pending: waiting or replaying
  // costs nothing. A configuration change makes readiness stale on the
  // server, so it gets a new key rather than a replay of the old check.
  function checkWhenStale(value: ShowAvailability | null, signal: AbortSignal) {
    if (!value || value.checked_at || signal.aborted) return;
    const windowKey = readinessKey(Date.now(), value.configuration_fingerprint);
    if (
      !probeJob.current &&
      !probeKey.current &&
      autoProbeWindow.current === windowKey
    )
      return;
    autoProbeWindow.current = windowKey;
    void checkReadiness(signal, windowKey);
  }

  const activate = useEffectEvent((signal: AbortSignal) => {
    void loadRecent(signal);
    void loadAvailability(signal).then((value) =>
      checkWhenStale(value, signal),
    );
  });

  const deactivate = useEffectEvent(() => {
    controller.current?.abort();
    setBusy(false);
    setStoppable(false);
    setStatus((current) => (current === READING_TEXT ? "" : current));
    if (pending.current) setUncertain(true);
  });

  useEffect(() => {
    if (!active) {
      deactivate();
      return;
    }
    const abort = new AbortController();
    activation.current = abort;
    activate(abort.signal);
    return () => {
      abort.abort();
      if (activation.current === abort) activation.current = null;
    };
  }, [active]);

  useEffect(() => () => controller.current?.abort(), []);

  function changed() {
    pending.current = null;
    key.current = crypto.randomUUID();
    setError("");
    setStatus("");
    setUncertain(false);
  }

  // `onDraft` is only called from flows the editor started (Find dates,
  // Retry import, Open), never from an Effect, so it is read directly: an
  // Effect Event may only be called from Effects.
  function receive(job: ShowJob) {
    const execution = job.result?.execution;
    const draft = job.result?.draft;
    // «Pasted text» only ever holds what the editor typed or pasted: the
    // text Crate read stays in each row's evidence, so running the import
    // again never sends it back as if the editor had pasted it.
    if (draft?.candidates) {
      const added = onDraft({ ...draft, draft_id: execution?.draft_id });
      setWarnings(uniqueWarnings(draft.warnings));
      setStatus(foundText(draft, added !== false));
    }
    if (job.status === "cancelled") {
      if (!draft?.candidates) setStatus(STOPPED_TEXT);
    } else if (job.status !== "completed") {
      if (!draft?.candidates) setStatus("");
      setError(
        showErrorText(
          Object.assign(new Error(execution?.error ?? ""), {
            code: execution?.error_code,
          }),
          UNFINISHED_TEXT,
        ),
      );
      if (execution?.error_code && MODEL_ERROR_CODES.has(execution.error_code))
        refreshAvailability();
    }
    refreshRecent();
  }

  function settle(abort: AbortController) {
    if (controller.current !== abort) return;
    setBusy(false);
    setStoppable(false);
  }

  async function run() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setUncertain(false);
    setWarnings([]);
    setStatus(READING_TEXT);
    try {
      if (!pending.current) {
        if (!method) throw new Error(EXTRACT_FAILED_TEXT);
        key.current ??= crypto.randomUUID();
        const imageMode = IMAGE_METHODS.has(method);
        const uploads: string[] = imageMode ? [...storedImages] : [];
        if (imageMode) {
          // At most three images. Settle every upload before unlocking a
          // failed attempt; keep source order even when responses arrive
          // out of order.
          const settled = await Promise.allSettled(
            images.map(({ file }) => {
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
            ...settled.map((upload) => {
              if (upload.status === "rejected") throw upload.reason;
              return upload.value.upload_id;
            }),
          );
        }
        // An AI request carries exactly the model and configuration shown on
        // its card; the server refuses it if either changed since.
        const consent = isModelMethod(method)
          ? availability?.actions?.[method]
          : null;
        pending.current = {
          payload: {
            mode: method,
            upload_ids: uploads,
            raw_text: text,
            source_url: url || null,
            expected_model: consent ? (consent.model ?? null) : null,
            expected_configuration: consent
              ? (consent.configuration_fingerprint ?? null)
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
      setStoppable(true);
      const finished = await waitForShowJob(request.jobId, abort.signal);
      if (abort.signal.aborted) return;
      receive(finished);
      pending.current = null;
      key.current = crypto.randomUUID();
    } catch (failure) {
      if (abort.signal.aborted) return;
      setStatus("");
      setError(showErrorText(failure, EXTRACT_FAILED_TEXT));
      if (isRefusal(failure)) {
        pending.current = null;
        key.current = crypto.randomUUID();
        setUncertain(false);
        const code = errorCode(failure);
        if (code && MODEL_ERROR_CODES.has(code)) refreshAvailability();
      } else if (pending.current) setUncertain(true);
    } finally {
      settle(abort);
    }
  }

  async function reopen(row: ShowDraftRow) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    changed();
    setBusy(true);
    setWarnings([]);
    try {
      const saved = await api<SavedDraft>(
        `/api/show-imports/drafts/${encodeURIComponent(row.id)}`,
        "GET",
        undefined,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      // The stored input keeps the editor's own pasted text apart from the
      // text Crate read, so only that comes back into «Pasted text».
      setTextValue(saved.input?.raw_text ?? "");
      if (saved.input) {
        setStoredImages(saved.input.upload_ids ?? []);
        setImages([]);
        setUrlValue(saved.input.source_url ?? "");
        // Only a free method is restored. An AI method must be picked again
        // on its card, with the model it shows now.
        const mode = saved.input.mode;
        setChosen(mode === "ocr" || mode === "parse" ? mode : null);
      }
      if (saved.result?.candidates) {
        onDraft({ ...saved.result, draft_id: row.id });
        setWarnings(uniqueWarnings(saved.result.warnings));
        setStatus(REOPENED_TEXT);
        return;
      }
      pending.current = { payload: {}, jobId: row.job_id };
      setStoppable(true);
      setStatus(READING_TEXT);
      const job = await waitForShowJob(row.job_id, abort.signal);
      if (abort.signal.aborted) return;
      receive(job);
      pending.current = null;
      key.current = crypto.randomUUID();
    } catch (failure) {
      if (abort.signal.aborted) return;
      setStatus("");
      setError(showErrorText(failure, REOPEN_FAILED_TEXT));
      if (isRefusal(failure)) {
        pending.current = null;
        key.current = crypto.randomUUID();
      } else if (pending.current) setUncertain(true);
    } finally {
      settle(abort);
    }
  }

  async function requestStop() {
    const jobId = pending.current?.jobId;
    if (!jobId) return;
    try {
      const state = await api<{ cancellation_acknowledged?: boolean }>(
        `/api/show-imports/jobs/${encodeURIComponent(jobId)}/cancel`,
        "POST",
      );
      setStatus(
        state?.cancellation_acknowledged ? STOPPED_TEXT : STOP_REQUESTED_TEXT,
      );
    } catch {
      setError(STOP_FAILED_TEXT);
    }
  }

  function addImages(incoming: File[]) {
    if (!incoming.length) return;
    if (
      images.length + storedImages.length + incoming.length > MAX_IMAGES ||
      incoming.some(
        (file) =>
          file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.includes(file.type),
      )
    ) {
      setError(IMAGE_LIMIT_TEXT);
      return;
    }
    const added = incoming.map((file) => ({ id: crypto.randomUUID(), file }));
    setImages((current) => [...current, ...added]);
    changed();
  }

  return {
    availability,
    availabilityFailed,
    readiness,
    text,
    url,
    images,
    storedImages,
    options,
    method,
    recent,
    busy,
    uncertain,
    canExtract,
    canStop: busy && stoppable,
    status,
    warnings,
    error,
    setText(value) {
      setTextValue(value);
      changed();
    },
    setUrl(value) {
      setUrlValue(value);
      changed();
    },
    addImages,
    removeImage(id) {
      setImages((current) => current.filter((image) => image.id !== id));
      changed();
    },
    clearStoredImages() {
      setStoredImages([]);
      changed();
    },
    chooseMethod(next) {
      setChosen(next);
      changed();
    },
    extract() {
      if (canExtract) void run();
    },
    retry() {
      if (active && !busy && pending.current) void run();
    },
    stop() {
      void requestStop();
    },
    recheck() {
      const signal = activation.current?.signal;
      if (signal && !signal.aborted) void checkReadiness(signal, null);
    },
    recover(row) {
      if (active && !busy) void reopen(row);
    },
    reset() {
      // Clears the source and its result; availability, readiness and recent
      // imports are kept, so a fresh start spends no extra request.
      controller.current?.abort();
      changed();
      setTextValue("");
      setUrlValue("");
      setImages([]);
      setStoredImages([]);
      setChosen(null);
      setWarnings([]);
      setBusy(false);
      setStoppable(false);
    },
    reloadAvailability() {
      const signal = activation.current?.signal;
      if (signal && !signal.aborted)
        void loadAvailability(signal).then((value) =>
          checkWhenStale(value, signal),
        );
    },
  };
}
