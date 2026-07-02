import { useState, useEffect, useRef, useMemo } from "react";
import { CRATE_ICON_SIZE, X, Loader2 } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { usePlayerActions, usePlayerProgress } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsData {
  synced: LyricLine[] | null;
  plain: string | null;
}

function parseSyncedLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of lrc.split("\n")) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (match) {
      const min = parseInt(match[1]!);
      const sec = parseInt(match[2]!);
      const ms = parseInt(match[3]!.padEnd(3, "0"));
      const time = min * 60 + sec + ms / 1000;
      const text = match[4]!.trim();
      if (text) lines.push({ time, text });
    }
  }
  return lines;
}

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LyricsPanel({ open, onClose }: LyricsPanelProps) {
  const { t } = useTranslation();
  const { currentTime } = usePlayerProgress();
  const { currentTrack, seek } = usePlayerActions();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch lyrics when track changes
  useEffect(() => {
    if (!open || !currentTrack) return;
    setLyrics(null);
    setLoading(true);

    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(
      `/api/lyrics?artist=${encodeURIComponent(
        currentTrack.artist,
      )}&title=${encodeURIComponent(currentTrack.title)}`,
    )
      .then((data) => {
        if (!data) {
          setLyrics({ synced: null, plain: null });
          return;
        }
        const synced = data.syncedLyrics
          ? parseSyncedLyrics(data.syncedLyrics)
          : null;
        const plain = data.plainLyrics || null;
        setLyrics({ synced, plain });
      })
      .catch(() => setLyrics({ synced: null, plain: null }))
      .finally(() => setLoading(false));
  }, [open, currentTrack?.id]);

  // Find active line index
  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    for (let i = lyrics.synced.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.synced[i]!.time) return i;
    }
    return -1;
  }, [currentTime, lyrics?.synced]);

  // Auto-scroll only when active line changes (not every currentTime tick)
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div className="listen-glass-panel listen-glass-panel--dock z-app-player-drawer fixed right-0 top-0 bottom-[72px] flex w-[480px] flex-col overflow-hidden border-l border-white/10">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle at top, rgba(6,182,212,0.22) 0%, transparent 72%)",
        }}
      />
      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-bold text-white">{t("player.lyrics")}</h2>
        <button
          onClick={onClose}
          aria-label={t("player.lyrics.close")}
          className="flex size-10 items-center justify-center text-white/40 transition-colors hover:text-white"
        >
          <X size={CRATE_ICON_SIZE.xl} />
        </button>
      </div>

      {/* Track info */}
      {currentTrack && (
        <div className="relative border-b border-white/5 px-4 py-3">
          <p className="text-[13px] font-medium text-white truncate">
            {currentTrack.title}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {currentTrack.artist}
          </p>
        </div>
      )}

      {/* Lyrics content */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-y-auto lyrics-mask"
      >
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="text-primary animate-spin" />
          </div>
        )}

        {!loading && !lyrics?.synced && !lyrics?.plain && (
          <div className="px-4 py-16 text-center text-white/20 text-sm">
            {t("player.lyrics.empty")}
          </div>
        )}

        {/* Synced lyrics */}
        {lyrics?.synced && (
          <div
            className="space-y-1 px-3"
            style={{ paddingTop: "38vh", paddingBottom: "38vh" }}
          >
            {lyrics.synced.map((line, i) => {
              const isActive = i === activeIndex;
              const isPast = i < activeIndex;
              return (
                <button
                  key={i}
                  ref={isActive ? activeRef : null}
                  onClick={() => seek(line.time)}
                  className={`relative z-20 w-full rounded-md px-2 py-1 text-left transition-all duration-500 ${
                    isActive
                      ? "bg-primary/10 text-[17px] font-semibold text-primary"
                      : isPast
                        ? "text-[14px] text-white/25"
                        : "text-[14px] text-white/50"
                  }`}
                  style={
                    isActive
                      ? {
                          textShadow: "0 0 20px rgba(6,182,212,0.28)",
                        }
                      : undefined
                  }
                >
                  {line.text}
                </button>
              );
            })}
          </div>
        )}

        {/* Plain lyrics (no sync) */}
        {!lyrics?.synced && lyrics?.plain && (
          <div className="px-4 py-8">
            <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-muted-foreground">
              {lyrics.plain}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
