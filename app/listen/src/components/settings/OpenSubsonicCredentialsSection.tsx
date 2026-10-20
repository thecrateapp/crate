import { useSettingsOverlay } from "./settings-panel-activity";
import { useEffect, useRef, useState } from "react";

import { OpenSubsonicSettingsView } from "./OpenSubsonicSettingsView";
import { api } from "@/lib/api";

const CREDENTIAL_URL = "/api/auth/subsonic-token";

interface CredentialStatus {
  configured: boolean;
}

interface CreatedCredential {
  api_key: string;
}

type ConfirmedAction = "rotate" | "revoke";
type Notice = "created" | "copied" | "hidden";
type RequestError = "copy" | "operation";

export function OpenSubsonicCredentialsSection() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState(false);
  const copyInProgress = useRef(false);
  const [confirmOpen, setConfirmOpen] = useSettingsOverlay();
  const [confirmingAction, setConfirmingAction] =
    useState<ConfirmedAction>("rotate");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);

    api<CredentialStatus>(CREDENTIAL_URL)
      .then((response) => {
        if (active) setConfigured(response.configured);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshAttempt]);

  async function createCredential() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api<CreatedCredential>(CREDENTIAL_URL, "POST");
      if (!response.api_key) throw new Error("Missing OpenSubsonic key");
      setConfigured(true);
      setSecret(response.api_key);
      setNotice("created");
    } catch {
      setError("operation");
    } finally {
      setBusy(false);
    }
  }

  async function revokeCredential() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(CREDENTIAL_URL, "DELETE");
      setConfigured(false);
      setSecret(null);
    } catch {
      setError("operation");
    } finally {
      setBusy(false);
    }
  }

  function requestConfirmation(action: ConfirmedAction) {
    setConfirmingAction(action);
    setConfirmOpen(true);
  }

  async function confirmAction() {
    if (confirmingAction === "rotate") {
      await createCredential();
    } else {
      await revokeCredential();
    }
  }

  async function copyCredential() {
    if (!secret || copyInProgress.current) return;
    copyInProgress.current = true;
    setError(null);
    try {
      await navigator.clipboard.writeText(secret);
      setSecret(null);
      setNotice("copied");
    } catch {
      setError("copy");
    } finally {
      copyInProgress.current = false;
    }
  }

  return (
    <OpenSubsonicSettingsView
      configured={configured}
      loading={loading}
      loadError={loadError}
      secret={secret}
      notice={notice}
      error={error}
      busy={busy}
      confirmOpen={confirmOpen}
      confirmingAction={confirmingAction}
      onConfirmOpenChange={setConfirmOpen}
      onConfirm={confirmAction}
      onRequestConfirmation={requestConfirmation}
      onRetry={() => setRefreshAttempt((attempt) => attempt + 1)}
      onCreate={() => void createCredential()}
      onCopy={() => void copyCredential()}
      onHide={() => {
        setSecret(null);
        setNotice("hidden");
        setError(null);
      }}
    />
  );
}
