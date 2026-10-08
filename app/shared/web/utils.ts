export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function formatBitrate(kbps: number | null): string {
  if (!kbps) return "-";
  return `${kbps}k`;
}

export function formatNumber(n: number): string {
  return (n || 0).toLocaleString();
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function encPath(s: string): string {
  return encodeURIComponent(s);
}

export function formatBadgeClass(_format?: string): string {
  return "inline-flex items-center rounded-md border border-primary/30 text-primary text-[10px] px-1 py-0 font-medium";
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`;
}

const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function formatRelativeTime(
  date: string | number | Date,
  locale: string,
  now: number = Date.now(),
): string {
  const diffSeconds = (new Date(date).getTime() - now) / 1000;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(Math.round(diffSeconds / 60), "minute");
}
