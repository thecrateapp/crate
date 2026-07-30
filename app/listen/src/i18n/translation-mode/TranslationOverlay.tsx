import { Loader2, X } from "@crate/ui/icons/translation";

import { Button } from "@crate/ui/shadcn/button";
import { useTranslationOverlay } from "@/i18n/translation-mode/useTranslationOverlay";

export function TranslationOverlay() {
  const {
    active,
    available,
    hoveredMarker,
    hoveredRect,
    selectedTarget,
    draftValue,
    saveStatus,
    setDraftValue,
    closeEditor,
    saveSelected,
  } = useTranslationOverlay();

  if (!available || !active) {
    return null;
  }

  return (
    <div
      data-translation-overlay
      className="pointer-events-none fixed inset-0 z-[9999]"
    >
      <div className="pointer-events-none absolute inset-0">
        {hoveredRect ? (
          <div
            className="absolute rounded-[4px] border border-cyan-300/40 bg-cyan-300/[0.06] shadow-[0_0_18px_rgba(34,211,238,0.18)]"
            style={{
              height: hoveredRect.height,
              transform: `translate(${hoveredRect.left}px, ${hoveredRect.top}px)`,
              width: hoveredRect.width,
            }}
          />
        ) : null}
        {hoveredMarker ? (
          <div className="absolute right-4 bottom-4 rounded-md border border-cyan-300/25 bg-black/55 px-3 py-2 text-xs text-cyan-50 shadow-[0_18px_48px_rgba(0,0,0,0.42),0_0_18px_rgba(34,211,238,0.18)] backdrop-blur-xl">
            <div className="font-semibold">Translation Mode</div>
            <code className="mt-1 block font-mono text-[11px] text-cyan-200/85">
              {hoveredMarker.key}
            </code>
          </div>
        ) : (
          <div className="absolute right-4 bottom-4 rounded-md border border-white/10 bg-black/45 px-3 py-2 text-xs text-white/65 shadow-[0_18px_48px_rgba(0,0,0,0.36)] backdrop-blur-xl">
            Translation Mode
          </div>
        )}
      </div>

      {selectedTarget ? (
        <section
          role="dialog"
          aria-label="Edit translation"
          className="pointer-events-auto absolute right-4 bottom-20 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-cyan-300/20 bg-[#090b10]/82 text-white shadow-[0_24px_80px_rgba(0,0,0,0.52),0_0_28px_rgba(34,211,238,0.14)] backdrop-blur-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Edit translation</div>
              <code className="mt-1 block truncate font-mono text-[11px] text-cyan-200/85">
                {selectedTarget.key}
              </code>
            </div>
            <button
              type="button"
              aria-label="Close translation editor"
              onClick={closeEditor}
              className="text-white/45 transition-[color,filter] hover:text-cyan-200 hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3 px-4 py-4">
            <Field label="Locale" value={selectedTarget.locale} />
            <Field label="English source" value={selectedTarget.sourceValue} />
            <Field label="Quality status" value="Not checked locally" />

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
                Current value
              </span>
              <textarea
                aria-label="Current value"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                className="min-h-24 w-full resize-y rounded-md border border-white/10 bg-black/24 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-cyan-300/45"
              />
            </label>

            {saveStatus === "error" ? (
              <p className="text-xs text-red-200">
                Could not save the local catalog.
              </p>
            ) : null}
            {saveStatus === "saved" ? (
              <p className="text-xs text-emerald-200">
                Saved to workspace JSON.
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="rounded-lg"
                onClick={() => void saveSelected()}
                disabled={saveStatus === "saving"}
              >
                {saveStatus === "saving" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : null}
                Save translation
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
        {label}
      </div>
      <div className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-2 text-sm text-white/80">
        {value || "-"}
      </div>
    </div>
  );
}
