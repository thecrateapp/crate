import { useEffect, useState } from "react";

import {
  clearDevLogs,
  DEV_LOG_EVENT,
  getDevLogs,
  type DevLogEntry,
} from "@/lib/dev-logs";
import { isTauriRuntime } from "@/lib/platform";

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TauriDevLogPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<DevLogEntry[]>(() => getDevLogs());

  useEffect(() => {
    const onLog = () => setLogs(getDevLogs());
    window.addEventListener(DEV_LOG_EVENT, onLog);
    return () => window.removeEventListener(DEV_LOG_EVENT, onLog);
  }, []);

  if (!isTauriRuntime || !import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] max-w-[calc(100vw-2rem)] font-mono text-xs text-slate-100">
      {open ? (
        <div className="w-[min(46rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-cyan-400/25 bg-[#05070b]/95 shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div>
              <div className="font-sans text-sm font-semibold text-white">Tauri playback logs</div>
              <div className="text-[0.65rem] uppercase tracking-[0.18em] text-cyan-300/80">{logs.length} events</div>
            </div>
            <div className="flex gap-2 font-sans">
              <button
                type="button"
                className="rounded border border-white/10 px-2 py-1 text-slate-300 hover:border-cyan-300/40 hover:text-white"
                onClick={clearDevLogs}
              >
                Clear
              </button>
              <button
                type="button"
                className="rounded border border-white/10 px-2 py-1 text-slate-300 hover:border-cyan-300/40 hover:text-white"
                onClick={() => setOpen(false)}
              >
                Hide
              </button>
            </div>
          </div>
          <div className="max-h-[42vh] overflow-auto px-3 py-2">
            {logs.length === 0 ? (
              <div className="py-6 text-center font-sans text-slate-500">No playback events yet.</div>
            ) : (
              logs.slice().reverse().map((entry) => (
                <div key={entry.id} className="border-b border-white/5 py-2 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">{timeLabel(entry.timestamp)}</span>
                    <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 uppercase tracking-wide text-cyan-200">
                      {entry.scope}
                    </span>
                    <span className={
                      entry.level === "error"
                        ? "text-red-300"
                        : entry.level === "warn"
                          ? "text-amber-300"
                          : "text-slate-100"
                    }>
                      {entry.message}
                    </span>
                  </div>
                  {entry.detail ? (
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[0.68rem] leading-relaxed text-slate-400">
                      {entry.detail}
                    </pre>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="rounded-md border border-cyan-400/30 bg-[#05070b]/90 px-3 py-2 font-sans text-xs font-semibold text-cyan-100 shadow-xl shadow-black/50 hover:border-cyan-300/60"
          onClick={() => setOpen(true)}
        >
          Logs {logs.length}
        </button>
      )}
    </div>
  );
}
