export const TAURI_AUTH_DIAGNOSTIC_EVENT = "crate:tauri-auth-diagnostic";
export const TAURI_AUTH_DIAGNOSTIC_KEY = "crate-tauri-auth-diagnostic:v1";
const MAX_STATUS_LENGTH = 80;
const MAX_DETAIL_LENGTH = 160;
const SENSITIVE_DIAGNOSTIC =
  /(?:https?:\/\/|tauri:\/\/|cratemusic:\/\/|[?&]|(?:authorization|set-cookie|cookie|password|passwd|secret|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|token|session[_ -]?key|verifier|oauth[_ -]?code|\bcode|\bstate)\s*[:=]|\/Users\/|\/home\/|\b[A-Z]:\\Users\\)/i;

export interface TauriAuthDiagnostic {
  status: string;
  detail?: string;
  at: string;
}

export function getTauriAuthDiagnostic(): TauriAuthDiagnostic | null {
  try {
    const raw = localStorage.getItem(TAURI_AUTH_DIAGNOSTIC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TauriAuthDiagnostic>;
    const at =
      typeof parsed.at === "string" ? safeDiagnosticTimestamp(parsed.at) : null;
    if (typeof parsed.status !== "string" || !at) {
      localStorage.removeItem(TAURI_AUTH_DIAGNOSTIC_KEY);
      return null;
    }
    const sanitized: TauriAuthDiagnostic = {
      status:
        safeDiagnosticText(parsed.status, MAX_STATUS_LENGTH) ??
        "Desktop diagnostic",
      detail:
        typeof parsed.detail === "string"
          ? safeDiagnosticText(parsed.detail, MAX_DETAIL_LENGTH)
          : undefined,
      at,
    };
    if (JSON.stringify(sanitized) !== raw) {
      localStorage.setItem(
        TAURI_AUTH_DIAGNOSTIC_KEY,
        JSON.stringify(sanitized),
      );
    }
    return sanitized;
  } catch {
    return null;
  }
}

export function recordTauriAuthDiagnostic(
  status: string,
  detail?: string,
): void {
  const diagnostic: TauriAuthDiagnostic = {
    status:
      safeDiagnosticText(status, MAX_STATUS_LENGTH) ?? "Desktop diagnostic",
    detail:
      detail === undefined
        ? undefined
        : safeDiagnosticText(detail, MAX_DETAIL_LENGTH),
    at: new Date().toISOString(),
  };

  try {
    localStorage.setItem(TAURI_AUTH_DIAGNOSTIC_KEY, JSON.stringify(diagnostic));
  } catch {
    // Ignore persistence failures; the in-memory event still helps dev QA.
  }

  try {
    window.dispatchEvent(
      new CustomEvent<TauriAuthDiagnostic>(TAURI_AUTH_DIAGNOSTIC_EVENT, {
        detail: diagnostic,
      }),
    );
  } catch {
    // ignore
  }
}

function safeDiagnosticText(
  value: string,
  maxLength: number,
): string | undefined {
  const normalized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  })
    .join("")
    .trim();
  if (!normalized || SENSITIVE_DIAGNOSTIC.test(normalized)) return undefined;
  return normalized.slice(0, maxLength);
}

function safeDiagnosticTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
