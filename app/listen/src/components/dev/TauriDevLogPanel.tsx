import { useSyncExternalStore, useState } from "react";
import {
  clearDevLogs,
  DEV_LOG_EVENT,
  getDevLogsSnapshot,
} from "@/lib/dev-logs";
import { isTauriRuntime } from "@/lib/platform";
import { TauriDevLogPanelView } from "./TauriDevLogPanelView";

const EMPTY_LOGS: ReturnType<typeof getDevLogsSnapshot> = [];
function subscribe(onStoreChange: () => void) {
  window.addEventListener(DEV_LOG_EVENT, onStoreChange);
  return () => window.removeEventListener(DEV_LOG_EVENT, onStoreChange);
}

export function TauriDevLogPanel() {
  if (!isTauriRuntime || !import.meta.env.DEV) return null;
  return <ActiveTauriDevLogPanel />;
}

function ActiveTauriDevLogPanel() {
  const [open, setOpen] = useState(false);
  const logs = useSyncExternalStore(
    subscribe,
    getDevLogsSnapshot,
    () => EMPTY_LOGS,
  );
  return (
    <div
      className={`fixed bottom-4 left-4 z-app-debug-overlay ${
        open ? "w-[min(46rem,calc(100vw-2rem))]" : "w-fit"
      }`}
    >
      <TauriDevLogPanelView
        logs={logs}
        open={open}
        onOpenChange={setOpen}
        onClear={clearDevLogs}
      />
    </div>
  );
}
